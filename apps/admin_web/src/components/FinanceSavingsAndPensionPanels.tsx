import {
  type FinanceAllocationRecord,
  type FinancePensionRecord,
  type FinanceSavingsRecord,
} from "../lib/financeModel";
import { SimpleMoneyRecordsPanel } from "./SimpleMoneyRecordsPanel";

export function FinanceSavingsPanel(props: {
  readonly records: readonly FinanceSavingsRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinanceSavingsRecord[]) => FinanceSavingsRecord[],
  ) => void;
}) {
  return (
    <SimpleMoneyRecordsPanel
      variant="savings"
      records={props.records}
      onPatch={props.onPatch}
      sheetId="savings"
      formSectionTitle="Savings record"
      tableSectionTitle="Savings"
      labelColumnHeader="Deposit"
      labelFormLabel="Deposit"
      labelInputId="savings-deposit"
      deleteConfirmMessage="Delete this savings record?"
      emptyMessage="No savings records yet."
      columnOrder="valueFirst"
    />
  );
}

export function FinancePensionPanel(props: {
  readonly records: readonly FinancePensionRecord[];
  readonly onPatch: (
    patch: (prev: readonly FinancePensionRecord[]) => FinancePensionRecord[],
  ) => void;
  readonly allocationRecords: readonly FinanceAllocationRecord[];
}) {
  return (
    <SimpleMoneyRecordsPanel
      variant="pension"
      records={props.records}
      pensionTaggedAllocationRecords={props.allocationRecords}
      onPatch={props.onPatch}
      sheetId="pension"
      formSectionTitle="Pension record"
      tableSectionTitle="Pension"
      labelColumnHeader="Fund"
      labelFormLabel="Fund"
      labelInputId="pension-fund"
      deleteConfirmMessage="Delete this pension record?"
      emptyMessage="No pension records yet."
      columnOrder="valueFirst"
    />
  );
}
