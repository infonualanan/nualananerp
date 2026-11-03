# หนังสือรับรองเงินเดือน / รายได้

Feature preview: `salary-certificate-demo.html` uses fictitious employee and signatory names, a memory-only store, and a visible sample watermark. Reloading the demo clears its history. No production Firebase connection is used by the demo. The public demo contains entirely fictitious company details; the authenticated ERP reads the real company profile privately from Firestore.

ERP entry: **8) ทรัพยากรบุคคล (HR) → หนังสือรับรองเงินเดือน**. The module is loaded on demand, with a contained error state so a failed load cannot interrupt login.

- Company identity and logo come from the existing company profile.
- Employee name, position, start date and initial basic salary come from the employee database. Salary overrides affect the letter only.
- Monthly and daily amounts are explicit; changing the unit clears amounts for re-entry. There is no assumed conversion between daily and monthly wages.
- Up to five fixed income items remain separate from basic pay. Cash or bank transfer must be selected.
- Signatories are employees with an active/leave status and the exact normalized title กรรมการผู้จัดการ or ผู้จัดการทั่วไป. Missing signatories link to employee setup; no real names or signatures are fabricated.
- Draft preview, review confirmation and final issue are separate. The employee still needs the selected signatory's actual signature on the printed document. Selecting a name is not authentication or digital approval by that person.
- Native browser printing opens an isolated A4 document with selectable text and a Save as PDF option. Draft and demo documents are visibly marked.

## Persistence

`hr_salary_certificates/{requestId}` stores the letter number, company/employee/signatory snapshots, amounts in satang, issue date, purpose, channel, issuer and timestamps. `hr_certificate_counters/{BuddhistYear}` allocates `NASC-2569-0001` style numbers in the same transaction. The year uses the Buddhist calendar and the four-digit sequence starts at 0001 each year, with a hard limit of 9999 to preserve the requested format. Requests are idempotent across uncertain retries; the UI reconciles a failed request before returning to editing.

The transaction rereads the source records and rejects changed company details, salary, employee status or signatory role after review. The normal UI does not edit issued letters. History prints the saved snapshot even after master records change.

The existing Firestore rules isolate records by authenticated account UID. This feature does not add company staff roles or claim that an owner cannot change their database outside the UI.

## Verification

`npm test` covers amount precision, role/date/source validation, snapshot preservation, transaction retries and numbering, stale review rejection, account switches, print escaping, cash/bank selection, signatory setup and uncertain-write reconciliation. The emulator-only suite also includes an actual SDK test for two devices and account isolation. Run it only with a Firebase emulator (`demo-erp-vault`), never against production.
