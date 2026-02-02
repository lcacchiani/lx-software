"""Database base class for SQLAlchemy models."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for SQLAlchemy models."""

    # Type hint for id column - actual column defined in subclasses
    id: Any
