import { LX_SOFTWARE_BOOK_KEY } from "../lib/statementOwners";
import { StatementBookPage } from "./StatementBookPage";

export function LxSoftwarePage() {
  return <StatementBookPage bookKey={LX_SOFTWARE_BOOK_KEY} />;
}
