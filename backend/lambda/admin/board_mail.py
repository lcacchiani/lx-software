"""Executive Board: email ingest, index, sending and the ``mail`` tools.

Flow (docs/architecture/executive-board-tools-plan.md §5.2):

- Cloudflare Email Routing fans every ``siutindei.com`` message out to the
  owner's inbox *and* to ``siutindei-board@<InboundMailDomain>``. SES stores
  the raw MIME under ``inbound-raw/<BOARD_MAIL_RAW_SEGMENT>/`` and
  ``inbound_email_handler`` hands the object to :func:`ingest_raw_object`.
- :func:`ingest_bytes` parses headers, the text body and attachment names,
  threads the message (``References`` / ``In-Reply-To`` first, then
  mailbox + normalised subject + counterpart) and writes thread + message
  rows with a 90-day TTL. Bodies are stored as received; contacts are
  pseudonymised **when read by a persona**, never for the owner.
- Sending goes through SES v2 from the mailbox the thread was addressed to,
  so replies from parents land back in the same Cloudflare-routed mailbox.
  Every outbound message is indexed as ``direction=out``.
"""

from __future__ import annotations

import hashlib
import html
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import formataddr, getaddresses, make_msgid, parsedate_to_datetime
from typing import Any

import boto3

import board_pii
import board_store
from contract_constants import (
    BOARD_MAIL_BODY_MAX_CHARS,
    BOARD_MAIL_LIST_MAX_THREADS,
    BOARD_MAIL_MAX_RECIPIENTS,
    BOARD_MAIL_SUBJECT_MAX_LEN,
)
from http_common import _log_event, _utc_iso_z

SNIPPET_CHARS = 200
ATTACHMENT_TEXT_MAX_CHARS = 20000
MAX_ATTACHMENTS = 20
_SUBJECT_PREFIX_RE = re.compile(r"^\s*((re|fw|fwd|aw|wg|sv|antw)\s*(\[\d+\])?\s*:\s*)+", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_WS_RE = re.compile(r"[ \t\r\f\v]+")
_BLANKS_RE = re.compile(r"\n{3,}")

_sesv2: Any = None


class MailError(RuntimeError):
    """A mail operation could not be completed; the message is safe for the model."""


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def mail_domain() -> str:
    return (os.environ.get("BOARD_MAIL_DOMAIN") or "siutindei.com").strip().lower()


def raw_segment() -> str:
    """Segment after ``inbound-raw/`` that SES uses for the board mailbox."""
    return (os.environ.get("BOARD_MAIL_RAW_SEGMENT") or "siutindei").strip().strip("/").lower()


def inbound_address() -> str:
    return (os.environ.get("BOARD_MAIL_INBOUND_ADDRESS") or "").strip().lower()


def sending_enabled() -> bool:
    return (os.environ.get("BOARD_MAIL_SENDING_ENABLED") or "").strip().lower() in ("1", "true", "yes")


def own_domains() -> set[str]:
    out = {mail_domain()}
    inbound = inbound_address()
    if "@" in inbound:
        out.add(inbound.rsplit("@", 1)[1])
    return out


def pseudonymizer(table: Any) -> board_pii.Pseudonymizer:
    return board_pii.Pseudonymizer(table, own_domains=own_domains())


def _ses_client() -> Any:
    global _sesv2
    if _sesv2 is None:
        _sesv2 = boto3.client("sesv2")
    return _sesv2


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

@dataclass
class ParsedMail:
    rfc_message_id: str
    in_reply_to: str
    references: list[str]
    subject: str
    from_address: str
    from_name: str
    to: list[str]
    cc: list[str]
    date: str
    text: str
    attachments: list[dict[str, Any]] = field(default_factory=list)
    mailbox: str = ""
    raw_size: int = 0


def normalize_subject(subject: str) -> str:
    cleaned = _SUBJECT_PREFIX_RE.sub("", subject or "")
    return " ".join(cleaned.split()).lower()[:BOARD_MAIL_SUBJECT_MAX_LEN]


def html_to_text(markup: str) -> str:
    text = _SCRIPT_RE.sub(" ", markup or "")
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>|</h[1-6]>", "\n", text)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text)
    text = "\n".join(line.strip() for line in text.splitlines())
    return _BLANKS_RE.sub("\n\n", text).strip()


def _addresses(msg: EmailMessage, header: str) -> list[str]:
    values = msg.get_all(header, []) or []
    out: list[str] = []
    for _name, addr in getaddresses([str(v) for v in values]):
        norm = board_pii.normalize_email(addr)
        if norm and "@" in norm and norm not in out:
            out.append(norm)
    return out


def _clean_msgid(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def msgid_digest(rfc_message_id: str) -> str:
    return hashlib.sha1(_clean_msgid(rfc_message_id).lower().encode("utf-8")).hexdigest()[:32]


def detect_mailbox(msg: EmailMessage, domain: str) -> str:
    """The ``@domain`` address this message was sent to (or from, for outbound)."""
    for header in ("X-Original-To", "Delivered-To", "X-Forwarded-To", "Envelope-To", "To", "Cc", "Bcc"):
        for addr in _addresses(msg, header):
            if addr.endswith(f"@{domain}"):
                return addr
    for addr in _addresses(msg, "From"):
        if addr.endswith(f"@{domain}"):
            return addr
    return f"unknown@{domain}"


def _body_text(msg: EmailMessage) -> str:
    body = None
    try:
        body = msg.get_body(preferencelist=("plain", "html"))
    except Exception:  # pragma: no cover - malformed MIME
        body = None
    if body is None:
        return ""
    try:
        content = body.get_content()
    except Exception:  # pragma: no cover - undecodable payload
        payload = body.get_payload(decode=True)
        content = payload.decode("utf-8", "replace") if isinstance(payload, (bytes, bytearray)) else ""
    if not isinstance(content, str):
        return ""
    if body.get_content_type() == "text/html":
        content = html_to_text(content)
    content = content.replace("\r\n", "\n").strip()
    return content[:BOARD_MAIL_BODY_MAX_CHARS]


def _attachments(msg: EmailMessage) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for part in msg.iter_attachments():
        if len(out) >= MAX_ATTACHMENTS:
            break
        payload = part.get_payload(decode=True)
        size = len(payload) if isinstance(payload, (bytes, bytearray)) else 0
        entry: dict[str, Any] = {
            "name": os.path.basename(part.get_filename() or "attachment")[:180],
            "contentType": part.get_content_type(),
            "size": size,
        }
        if part.get_content_maintype() == "text" and isinstance(payload, (bytes, bytearray)):
            charset = part.get_content_charset() or "utf-8"
            try:
                entry["text"] = payload.decode(charset, "replace")[:ATTACHMENT_TEXT_MAX_CHARS]
            except LookupError:
                entry["text"] = payload.decode("utf-8", "replace")[:ATTACHMENT_TEXT_MAX_CHARS]
        out.append(entry)
    return out


def parse_mime(raw: bytes, *, domain: str | None = None) -> ParsedMail:
    domain = domain or mail_domain()
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    from_list = getaddresses([str(v) for v in (msg.get_all("From", []) or [])])
    from_name, from_addr = (from_list[0] if from_list else ("", ""))
    date_iso = ""
    if msg.get("Date"):
        try:
            date_iso = _utc_iso_z(parsedate_to_datetime(str(msg["Date"])))
        except (TypeError, ValueError):
            date_iso = ""
    references = [_clean_msgid(r) for r in str(msg.get("References") or "").split() if _clean_msgid(r)]
    return ParsedMail(
        rfc_message_id=_clean_msgid(msg.get("Message-ID")),
        in_reply_to=_clean_msgid(msg.get("In-Reply-To")),
        references=references,
        subject=" ".join(str(msg.get("Subject") or "").split())[:BOARD_MAIL_SUBJECT_MAX_LEN],
        from_address=board_pii.normalize_email(from_addr),
        from_name=" ".join(str(from_name or "").split())[:120],
        to=_addresses(msg, "To"),
        cc=_addresses(msg, "Cc"),
        date=date_iso,
        text=_body_text(msg),
        attachments=_attachments(msg),
        mailbox=detect_mailbox(msg, domain),
        raw_size=len(raw),
    )


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

def _is_own(address: str) -> bool:
    return board_pii.is_own_address(address, own_domains())


def counterpart(parsed: ParsedMail) -> str:
    """The external party in this message: the sender, or the first external recipient."""
    if parsed.from_address and not _is_own(parsed.from_address):
        return parsed.from_address
    for addr in [*parsed.to, *parsed.cc]:
        if not _is_own(addr):
            return addr
    return parsed.from_address


def _thread_id_for(table: Any, parsed: ParsedMail) -> str:
    for ref in [parsed.in_reply_to, *reversed(parsed.references)]:
        if not ref:
            continue
        found = board_store.get_mail_thread_for_msgid(table, msgid_digest(ref))
        if found:
            return found
    seed = f"{parsed.mailbox}|{normalize_subject(parsed.subject)}|{counterpart(parsed)}"
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:20]


def _snippet(text: str) -> str:
    return " ".join((text or "").split())[:SNIPPET_CHARS]


def ingest_bytes(
    table: Any,
    raw: bytes,
    *,
    direction: str = "in",
    source: str = "ses",
    received_at: str | None = None,
) -> dict[str, Any]:
    """Index one RFC 822 message. Returns ``{threadId, messageId, duplicate}``."""
    parsed = parse_mime(raw)
    if direction == "out" and parsed.from_address and _is_own(parsed.from_address):
        parsed.mailbox = parsed.from_address
    now = received_at or board_store.now_iso()
    message_id = board_store.new_id()
    thread_id = _thread_id_for(table, parsed)
    rfc_id = parsed.rfc_message_id or f"<{message_id}@{mail_domain()}>"
    if not board_store.put_mail_msgid(table, msgid_digest(rfc_id), thread_id=thread_id, message_id=message_id):
        existing = board_store.get_mail_thread_for_msgid(table, msgid_digest(rfc_id))
        _log_event("info", tag="board_mail_duplicate", thread=existing, size=parsed.raw_size)
        return {"threadId": existing or thread_id, "messageId": "", "duplicate": True}

    message = {
        "messageId": message_id,
        "threadId": thread_id,
        "rfcMessageId": rfc_id,
        "inReplyTo": parsed.in_reply_to,
        "direction": direction,
        "source": source,
        "mailbox": parsed.mailbox,
        "from": {"address": parsed.from_address, "name": parsed.from_name},
        "to": parsed.to,
        "cc": parsed.cc,
        "subject": parsed.subject,
        "date": parsed.date or now,
        "receivedAt": now,
        "text": parsed.text,
        "attachments": parsed.attachments,
        "rawSize": parsed.raw_size,
    }
    board_store.put_mail_message(table, message)

    thread = board_store.get_mail_thread(table, thread_id) or {
        "threadId": thread_id,
        "mailbox": parsed.mailbox,
        "subject": parsed.subject or "(no subject)",
        "normalizedSubject": normalize_subject(parsed.subject),
        "participants": [],
        "firstMessageAt": now,
        "messageCount": 0,
        "unread": False,
        "createdAt": now,
    }
    participants = [p for p in (thread.get("participants") or []) if isinstance(p, str)]
    for addr in [parsed.from_address, *parsed.to, *parsed.cc]:
        if addr and not _is_own(addr) and addr not in participants:
            participants.append(addr)
    thread.update(
        {
            "participants": participants[:20],
            "messageCount": int(thread.get("messageCount") or 0) + 1,
            "lastMessageAt": now,
            "lastDirection": direction,
            "lastFrom": parsed.from_address,
            "lastFromName": parsed.from_name if not _is_own(parsed.from_address) else "",
            "snippet": _snippet(parsed.text),
            "hasAttachments": bool(thread.get("hasAttachments")) or bool(parsed.attachments),
            "unread": bool(thread.get("unread")) or direction == "in",
            "updatedAt": now,
        }
    )
    if parsed.mailbox and str(thread.get("mailbox") or "").startswith("unknown@"):
        thread["mailbox"] = parsed.mailbox
    board_store.put_mail_thread(table, thread)
    _log_event(
        "info",
        tag="board_mail_indexed",
        thread=thread_id,
        direction=direction,
        mailbox=parsed.mailbox,
        attachments=len(parsed.attachments),
        size=parsed.raw_size,
    )
    return {"threadId": thread_id, "messageId": message_id, "duplicate": False}


def ingest_raw_object(bucket: str, key: str, *, s3: Any = None, table: Any = None) -> dict[str, Any]:
    """Read an SES drop from S3, index it, then delete the raw object."""
    s3 = s3 or boto3.client("s3")
    table = table if table is not None else board_store.records_table()
    obj = s3.get_object(Bucket=bucket, Key=key)
    raw = obj["Body"].read()
    result = ingest_bytes(table, raw, direction="in", source="ses")
    try:
        s3.delete_object(Bucket=bucket, Key=key)
    except Exception as exc:  # noqa: BLE001 - lifecycle rule expires it anyway
        _log_event("warning", tag="board_mail_raw_delete_failed", key=key[:256], error=str(exc)[:200])
    return result


# ---------------------------------------------------------------------------
# Owner views (unmasked)
# ---------------------------------------------------------------------------

def _matches(thread: dict[str, Any], words: list[str]) -> bool:
    hay = " ".join(
        str(thread.get(k) or "")
        for k in ("subject", "snippet", "lastFrom", "lastFromName", "mailbox")
    ).lower()
    hay += " " + " ".join(str(p) for p in (thread.get("participants") or [])).lower()
    return all(w in hay for w in words)


def thread_list(
    table: Any,
    *,
    mailbox: str = "",
    query: str = "",
    unread_only: bool = False,
    limit: int = 50,
) -> dict[str, Any]:
    threads = board_store.list_mail_threads(table)
    mailboxes: dict[str, dict[str, Any]] = {}
    for t in threads:
        box = str(t.get("mailbox") or "")
        entry = mailboxes.setdefault(box, {"address": box, "threadCount": 0, "unreadCount": 0, "lastMessageAt": ""})
        entry["threadCount"] += 1
        if t.get("unread"):
            entry["unreadCount"] += 1
        entry["lastMessageAt"] = max(str(entry["lastMessageAt"]), str(t.get("lastMessageAt") or ""))
    mailbox = board_pii.normalize_email(mailbox)
    if mailbox:
        threads = [t for t in threads if str(t.get("mailbox") or "") == mailbox]
    if unread_only:
        threads = [t for t in threads if t.get("unread")]
    words = [w for w in " ".join(str(query or "").lower().split()).split() if w]
    if words:
        threads = [t for t in threads if _matches(t, words)]
    limit = max(1, min(int(limit or 50), BOARD_MAIL_LIST_MAX_THREADS))
    return {
        "threads": threads[:limit],
        "total": len(threads),
        "mailboxes": sorted(mailboxes.values(), key=lambda m: str(m["address"])),
    }


def thread_detail(table: Any, thread_id: str) -> dict[str, Any] | None:
    thread = board_store.get_mail_thread(table, thread_id)
    if not thread:
        return None
    return {"thread": thread, "messages": board_store.list_mail_messages(table, thread_id)}


def mark_read(table: Any, thread_id: str, *, read: bool) -> bool:
    if not board_store.get_mail_thread(table, thread_id):
        return False
    board_store.set_mail_thread_unread(table, thread_id, unread=not read)
    return True


def status_summary(table: Any) -> dict[str, Any]:
    threads = board_store.list_mail_threads(table)
    return {
        "threadCount": len(threads),
        "unreadCount": sum(1 for t in threads if t.get("unread")),
        "domain": mail_domain(),
        "sendEnabled": sending_enabled(),
        "inboundAddress": inbound_address(),
    }


# ---------------------------------------------------------------------------
# Masked views for personas
# ---------------------------------------------------------------------------

def masked_thread(pseud: board_pii.Pseudonymizer, thread: dict[str, Any]) -> dict[str, Any]:
    return {
        "threadId": thread.get("threadId"),
        "mailbox": thread.get("mailbox"),
        "subject": pseud.mask_text(str(thread.get("subject") or "")),
        "participants": [pseud.alias_for_address(p) for p in (thread.get("participants") or [])],
        "lastFrom": pseud.alias_for_address(str(thread.get("lastFrom") or "")),
        "lastDirection": thread.get("lastDirection"),
        "lastMessageAt": thread.get("lastMessageAt"),
        "messageCount": thread.get("messageCount"),
        "unread": bool(thread.get("unread")),
        "hasAttachments": bool(thread.get("hasAttachments")),
        "snippet": pseud.mask_text(str(thread.get("snippet") or "")),
    }


def masked_message(pseud: board_pii.Pseudonymizer, message: dict[str, Any], *, text_limit: int = 4000) -> dict[str, Any]:
    sender = message.get("from") if isinstance(message.get("from"), dict) else {}
    return {
        "messageId": message.get("messageId"),
        "direction": message.get("direction"),
        "from": pseud.alias_for_address(str(sender.get("address") or "")),
        "to": [pseud.alias_for_address(a) for a in (message.get("to") or [])],
        "cc": [pseud.alias_for_address(a) for a in (message.get("cc") or [])],
        "date": message.get("date"),
        "subject": pseud.mask_text(str(message.get("subject") or "")),
        "text": pseud.mask_text(str(message.get("text") or "")[:text_limit]),
        "attachments": [
            {k: (pseud.mask_text(str(v)) if k == "text" else v) for k, v in a.items() if k in ("name", "contentType", "size", "text")}
            for a in (message.get("attachments") or [])
            if isinstance(a, dict)
        ],
    }


def masked_thread_detail(table: Any, thread_id: str) -> dict[str, Any] | None:
    detail = thread_detail(table, thread_id)
    if not detail:
        return None
    pseud = pseudonymizer(table)
    out = {
        "thread": masked_thread(pseud, detail["thread"]),
        "messages": [masked_message(pseud, m) for m in detail["messages"]],
    }
    pseud.save()
    return out


def digest_for_context(table: Any) -> dict[str, Any]:
    """Counts only (no subjects, no contacts) for the shared context pack."""
    threads = board_store.list_mail_threads(table)
    by_box: dict[str, int] = {}
    for t in threads:
        if t.get("unread"):
            box = str(t.get("mailbox") or "")
            by_box[box] = by_box.get(box, 0) + 1
    return {
        "threadCount": len(threads),
        "unreadCount": sum(by_box.values()),
        "mailboxes": [{"address": k, "unreadCount": v} for k, v in sorted(by_box.items())],
    }


# ---------------------------------------------------------------------------
# Allow-list and recipients
# ---------------------------------------------------------------------------

def recipient_allowed(settings: dict[str, Any], address: str) -> bool:
    addr = board_pii.normalize_email(address)
    if not addr or "@" not in addr:
        return False
    if _is_own(addr):
        return True
    entries = (settings.get("tools") or {}).get("allowList") or []
    domain = addr.rsplit("@", 1)[1]
    return any(e == addr or e == f"@{domain}" for e in entries if isinstance(e, str))


def resolve_recipients(pseud: board_pii.Pseudonymizer, values: Any) -> list[str]:
    """Aliases or addresses → real addresses; raises on unknown aliases."""
    if isinstance(values, str):
        values = [v for v in re.split(r"[,;\s]+", values) if v]
    if not isinstance(values, list):
        return []
    out: list[str] = []
    for value in values:
        resolved = pseud.resolve(str(value))
        if not resolved:
            raise MailError(f"Unknown contact '{value}'. Use an alias from a thread you read, or a full address.")
        addr = board_pii.normalize_email(resolved)
        if not board_pii.EMAIL_RE.fullmatch(addr):
            raise MailError(f"'{value}' is not an email address.")
        if addr not in out:
            out.append(addr)
    if len(out) > BOARD_MAIL_MAX_RECIPIENTS:
        raise MailError(f"At most {BOARD_MAIL_MAX_RECIPIENTS} recipients per message.")
    return out


def resolve_mailbox(value: Any) -> str:
    """``billing`` or ``billing@siutindei.com`` → ``billing@siutindei.com``."""
    text = board_pii.normalize_email(str(value or ""))
    if not text:
        raise MailError("fromMailbox is required (e.g. hello@" + mail_domain() + ").")
    if "@" not in text:
        text = f"{text}@{mail_domain()}"
    if not text.endswith(f"@{mail_domain()}") or text.startswith("unknown@"):
        raise MailError(f"Mail can only be sent from a {mail_domain()} mailbox.")
    if not board_pii.EMAIL_RE.fullmatch(text):
        raise MailError(f"'{value}' is not a valid mailbox.")
    return text


def _last_inbound(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for m in reversed(messages):
        if m.get("direction") == "in":
            return m
    return None


def outgoing_plan(table: Any, op: str, args: dict[str, Any]) -> dict[str, Any]:
    """Resolve what a write operation would send (real addresses; owner-facing).

    Returns ``{fromMailbox, to, cc, subject, text, inReplyTo, references, threadId}``.
    """
    pseud = pseudonymizer(table)
    body = pseud.unmask_text(str(args.get("body") or "").strip()[:BOARD_MAIL_BODY_MAX_CHARS])
    if op == "mail_send":
        to = resolve_recipients(pseud, args.get("to"))
        if not to:
            raise MailError("At least one recipient is required.")
        subject = " ".join(str(args.get("subject") or "").split())[:BOARD_MAIL_SUBJECT_MAX_LEN]
        if not subject:
            raise MailError("subject is required.")
        plan = {
            "fromMailbox": resolve_mailbox(args.get("fromMailbox")),
            "to": to,
            "cc": [],
            "subject": subject,
            "text": body,
            "inReplyTo": "",
            "references": [],
            "threadId": "",
        }
        pseud.save()
        return plan

    thread_id = str(args.get("threadId") or "").strip()
    detail = thread_detail(table, thread_id) if thread_id else None
    if not detail:
        raise MailError(f"Thread '{thread_id}' not found. Use mail_list_threads first.")
    thread, messages = detail["thread"], detail["messages"]
    last_in = _last_inbound(messages)
    last = messages[-1] if messages else None
    mailbox = str(thread.get("mailbox") or "")
    if mailbox.startswith("unknown@"):
        raise MailError("This thread's mailbox is unknown; use mail_send with an explicit fromMailbox.")
    subject = str(thread.get("subject") or "(no subject)")
    if op == "mail_reply":
        if not last_in:
            raise MailError("Nothing to reply to: this thread has no inbound message.")
        sender = last_in.get("from") if isinstance(last_in.get("from"), dict) else {}
        to = [board_pii.normalize_email(str(sender.get("address") or ""))]
        if not to[0] or _is_own(to[0]):
            raise MailError("The last inbound message has no external sender to reply to.")
        cc = [a for a in (last_in.get("cc") or []) if a and not _is_own(a) and a not in to][: BOARD_MAIL_MAX_RECIPIENTS - 1]
        refs = [r for r in [str(last_in.get("inReplyTo") or ""), str(last_in.get("rfcMessageId") or "")] if r]
        plan = {
            "fromMailbox": mailbox,
            "to": to,
            "cc": cc,
            "subject": subject if subject.lower().startswith("re:") else f"Re: {subject}",
            "text": body,
            "inReplyTo": str(last_in.get("rfcMessageId") or ""),
            "references": refs,
            "threadId": thread_id,
        }
        pseud.save()
        return plan

    if op == "mail_forward":
        to = resolve_recipients(pseud, args.get("to"))
        if not to:
            raise MailError("At least one recipient is required.")
        if not last:
            raise MailError("This thread has no messages to forward.")
        sender = last.get("from") if isinstance(last.get("from"), dict) else {}
        quoted = "\n".join(f"> {line}" for line in str(last.get("text") or "").splitlines()[:200])
        note = pseud.unmask_text(str(args.get("note") or "").strip()[:BOARD_MAIL_BODY_MAX_CHARS])
        text = (
            f"{note}\n\n" if note else ""
        ) + (
            f"---------- Forwarded message ----------\n"
            f"From: {sender.get('address') or ''}\n"
            f"Date: {last.get('date') or ''}\n"
            f"Subject: {last.get('subject') or subject}\n"
            f"To: {', '.join(last.get('to') or [])}\n\n{quoted}"
        )
        plan = {
            "fromMailbox": mailbox,
            "to": to,
            "cc": [],
            "subject": subject if subject.lower().startswith("fwd:") else f"Fwd: {subject}",
            "text": text,
            "inReplyTo": "",
            "references": [],
            "threadId": thread_id,
        }
        pseud.save()
        return plan
    raise MailError(f"Unknown mail operation {op}")


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------

def send_plan(table: Any, plan: dict[str, Any], *, sent_by: str) -> dict[str, Any]:
    """Send through SES v2 and index the outbound copy."""
    if not sending_enabled():
        raise MailError(
            "Email sending is switched off for this deployment (BoardMailSendingEnabled). "
            "The founder can send it manually from their mail client."
        )
    from_mailbox = resolve_mailbox(plan.get("fromMailbox"))
    to = [board_pii.normalize_email(a) for a in (plan.get("to") or []) if a]
    cc = [board_pii.normalize_email(a) for a in (plan.get("cc") or []) if a]
    if not to:
        raise MailError("At least one recipient is required.")
    text = str(plan.get("text") or "").strip()
    if not text:
        raise MailError("The message body is empty.")
    msg = EmailMessage()
    msg["From"] = formataddr(("siutindei", from_mailbox))
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = str(plan.get("subject") or "(no subject)")[:BOARD_MAIL_SUBJECT_MAX_LEN]
    msg["Message-ID"] = make_msgid(domain=mail_domain())
    if plan.get("inReplyTo"):
        msg["In-Reply-To"] = str(plan["inReplyTo"])
    if plan.get("references"):
        msg["References"] = " ".join(str(r) for r in plan["references"])
    msg["X-Siutindei-Board"] = sent_by[:80]
    msg.set_content(text)
    for att in plan.get("attachments") or []:
        if not isinstance(att, dict):
            continue
        payload = att.get("content")
        if not isinstance(payload, (bytes, bytearray)):
            continue
        filename = str(att.get("filename") or "attachment.bin")[:180]
        ctype = str(att.get("contentType") or "application/octet-stream")
        main, _, sub = ctype.partition("/")
        msg.add_attachment(
            bytes(payload),
            maintype=main or "application",
            subtype=sub or "octet-stream",
            filename=filename,
        )
    raw = msg.as_bytes()
    response = _ses_client().send_email(
        FromEmailAddress=str(msg["From"]),
        Destination={"ToAddresses": to, "CcAddresses": cc},
        Content={"Raw": {"Data": raw}},
    )
    indexed = ingest_bytes(table, raw, direction="out", source=f"board:{sent_by}"[:80])
    if indexed.get("threadId"):
        board_store.set_mail_thread_unread(table, str(indexed["threadId"]), unread=False)
    _log_event("info", tag="board_mail_sent", to=len(to), thread=indexed.get("threadId"), by=sent_by)
    return {
        "ok": True,
        "sesMessageId": str((response or {}).get("MessageId") or ""),
        "threadId": indexed.get("threadId"),
        "messageId": indexed.get("messageId"),
        "from": from_mailbox,
        "to": to,
        "cc": cc,
        "subject": str(msg["Subject"]),
    }


# ---------------------------------------------------------------------------
# Tool operations (persona-facing, masked)
# ---------------------------------------------------------------------------

def op_list_mailboxes(ctx: Any, _args: dict[str, Any]) -> dict[str, Any]:
    listing = thread_list(ctx.table, limit=1)
    return {
        "domain": mail_domain(),
        "sendEnabled": sending_enabled(),
        "mailboxes": listing["mailboxes"],
    }


def op_list_threads(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    try:
        limit = min(max(1, int(args.get("limit") or 15)), 30)
    except (TypeError, ValueError):
        limit = 15
    mailbox = str(args.get("mailbox") or "").strip()
    if mailbox and "@" not in mailbox:
        mailbox = f"{mailbox}@{mail_domain()}"
    listing = thread_list(
        ctx.table,
        mailbox=mailbox,
        query=str(args.get("query") or ""),
        unread_only=bool(args.get("unreadOnly")),
        limit=limit,
    )
    pseud = pseudonymizer(ctx.table)
    out = {
        "total": listing["total"],
        "items": [masked_thread(pseud, t) for t in listing["threads"]],
        "mailboxes": listing["mailboxes"],
    }
    pseud.save()
    return out


def op_get_thread(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    thread_id = str(args.get("threadId") or "").strip()
    detail = masked_thread_detail(ctx.table, thread_id) if thread_id else None
    if not detail:
        return {"error": f"Thread '{thread_id}' not found. Use mail_list_threads to find thread ids."}
    return detail


def op_contact_history(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    pseud = pseudonymizer(ctx.table)
    contact = pseud.resolve(str(args.get("contact") or ""))
    if not contact or "@" not in contact:
        return {"error": "Unknown contact alias. Use the alias exactly as shown in a thread (e.g. contact#3)."}
    threads = [t for t in board_store.list_mail_threads(ctx.table) if contact in (t.get("participants") or [])]
    out = {
        "contact": pseud.alias_for_address(contact),
        "threadCount": len(threads),
        "items": [masked_thread(pseud, t) for t in threads[:20]],
    }
    pseud.save()
    return out


def _op_write(op: str):
    def _run(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
        try:
            plan = outgoing_plan(ctx.table, op, args)
            sent = send_plan(ctx.table, plan, sent_by=f"{ctx.actor}:{ctx.persona_id}")
        except MailError as exc:
            return {"error": str(exc)}
        pseud = pseudonymizer(ctx.table)
        result = {
            **sent,
            "to": [pseud.alias_for_address(a) for a in sent["to"]],
            "cc": [pseud.alias_for_address(a) for a in sent["cc"]],
        }
        pseud.save()
        return result

    return _run


def act_guard(ctx: Any, args: dict[str, Any], *, op: str) -> str | None:
    """Reason an ``act``-level write must still go to the founder, or None."""
    try:
        plan = outgoing_plan(ctx.table, op, args)
    except MailError:
        return None  # the executor reports the error to the model
    blocked = [a for a in [*plan["to"], *plan["cc"]] if not recipient_allowed(ctx.settings, a)]
    if blocked:
        pseud = pseudonymizer(ctx.table)
        aliases = ", ".join(pseud.alias_for_address(a) for a in blocked)
        pseud.save()
        return f"recipient(s) {aliases} are not on the founder's allow-list"
    return None


def op_report_phishing(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    """Create a now-priority action so the founder reviews a suspected phishing thread."""
    thread_id = str(args.get("threadId") or "").strip()
    if not thread_id:
        raise MailError("threadId is required")
    thread = board_store.get_mail_thread(ctx.table, thread_id)
    if not thread:
        raise MailError(f"thread {thread_id} not found")
    note = str(args.get("note") or args.get("reason") or "").strip()
    subject = str(thread.get("subject") or "(no subject)")[:120]
    now = _utc_iso_z(datetime.now(timezone.utc))
    doc = {
        "actionId": board_store.new_id(),
        "title": f"Phishing report: {subject}"[:200],
        "detail": (note or f"CISO flagged mail thread {thread_id}.")[:800],
        "persona": getattr(ctx, "persona_id", None) or "ciso",
        "priority": "now",
        "effort": "S",
        "metric": "Thread reviewed and quarantined or cleared",
        "dependsOn": [],
        "status": "open",
        "note": "",
        "meetingId": getattr(ctx, "meeting_id", "") or "",
        "source": "tool",
        "reaffirmedByMeetingIds": [],
        "dueAt": None,
        "createdAt": now,
        "updatedAt": now,
        "threadId": thread_id,
    }
    board_store.put_action(ctx.table, doc)
    return {"ok": True, "actionId": doc["actionId"], "threadId": thread_id, "subject": subject}


def owner_preview_phishing(ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    thread_id = str(args.get("threadId") or "").strip()
    thread = board_store.get_mail_thread(ctx.table, thread_id) if thread_id else None
    if not thread:
        return {"error": f"thread {thread_id or '(missing)'} not found"}
    return {
        "kind": "phishing",
        "threadId": thread_id,
        "subject": str(thread.get("subject") or ""),
        "mailbox": str(thread.get("mailbox") or ""),
        "from": str(thread.get("lastFrom") or ""),
        "note": str(args.get("note") or args.get("reason") or ""),
    }


def owner_preview(ctx: Any, args: dict[str, Any], *, op: str) -> dict[str, Any] | None:
    """Unmasked rendering of what would be sent, for the Approvals card."""
    try:
        plan = outgoing_plan(ctx.table, op, args)
    except MailError as exc:
        return {"error": str(exc)}
    return {
        "kind": "email",
        "from": plan["fromMailbox"],
        "to": plan["to"],
        "cc": plan["cc"],
        "subject": plan["subject"],
        "text": plan["text"],
        "threadId": plan["threadId"],
        "sendEnabled": sending_enabled(),
    }
