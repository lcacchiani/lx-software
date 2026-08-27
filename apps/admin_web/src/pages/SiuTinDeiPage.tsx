import { SIU_TIN_DEI_BOOK_KEY } from "../lib/statementOwners";
import { StatementBookPage } from "./StatementBookPage";

export function SiuTinDeiPage() {
  return <StatementBookPage bookKey={SIU_TIN_DEI_BOOK_KEY} />;
}
