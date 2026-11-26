import {classifyVaultInputTax, clean, validDate} from './vault-core.mjs';
import {isCancelledRecord} from './payments-core.mjs';

const isVatMonth = value => /^(?:20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value || '');

const norm = value => clean(value).normalize('NFKC').toUpperCase().replace(/\s+/g, '');
const headOfficeBranches = new Set(['สำนักงานใหญ่', 'Head Office', 'H.O.', 'HQ'].map(norm));
const sellerTaxId = value => {
    const id = norm(value).replace(/-/g, '');
    return /^\d{13}$/.test(id) && id !== '0000000000000' ? id : '';
};
const sellerBranch = value => {
    const branch = norm(value);
    if (headOfficeBranches.has(branch)) return '00000';
    const code = branch.replace(/^(?:สาขา(?:ที่)?|BRANCH(?:NO\.?)?)/, '');
    return /^\d{1,5}$/.test(code) ? code.padStart(5, '0') : '';
};
const inactive = doc => isCancelledRecord(doc) || ['draft', 'deleted', 'rejected'].includes(clean(doc.status).toLowerCase());
const bangkokDate = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'});
function erpDate(doc) {
    if (validDate(doc.inputDate)) return doc.inputDate;
    const raw = doc.rawDate;
    if (!raw) return '';
    if (validDate(raw)) return raw;
    const date = typeof raw.toDate === 'function' ? raw.toDate() : new Date(raw);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = Object.fromEntries(bangkokDate.formatToParts(date).map(({type,value}) => [type,value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function cents(value, rate) {
    const amount = clean(value);
    if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(amount)) throw new Error('invalid amount');
    const scaled = Number(amount.replace(/,/g, '')) * rate;
    const rounded = Math.sign(scaled) * Math.round((Math.abs(scaled) + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(rounded)) throw new Error('invalid amount');
    return rounded;
}

// We only combine verified evidence with the same supplier, branch and original invoice number.
// A candidate with missing identity fields may require review, but is never merged by name alone.
function possiblySameInvoice(a, b) {
    if (a.taxId && b.taxId && a.taxId !== b.taxId || a.branch && b.branch && a.branch !== b.branch) return false;
    return a.taxId && b.taxId ? a.taxId === b.taxId : !!a.partyKey && a.partyKey === b.partyKey;
}

export function buildPurchaseVatReport(documents, records, {period, company, today, exchangeRates = {}}) {
    if (!isVatMonth(period)) throw new Error('เลือกเดือนรายงานภาษีซื้อ');
    const byNumber = new Map(), rows = [], issues = [];
    let duplicates = 0;
    const note = (group, reason) => {
        if (group.some(row => row.month === period)) issues.push({entries: group, reason});
    };
    const add = row => {
        const number = norm(row.number);
        if (!number) { note([row], 'ไม่พบเลขใบกำกับภาษีของผู้ขาย'); return; }
        row.partyKey = norm(row.party);
        if (!byNumber.has(number)) byNumber.set(number, []);
        byNumber.get(number).push(row);
    };

    for (const doc of documents) {
        if (doc.isInputTax !== true || inactive(doc)) continue;
        const date = erpDate(doc);
        if (!date) continue;
        const row = {source:'erp', id:doc.docNo, number:clean(doc.vendorInvNo), date, month:date.slice(0,7),
            party:clean(doc.customerName), taxId:sellerTaxId(doc.customerTaxId), branch:sellerBranch(doc.customerBranch)};
        try {
            const currency = norm(doc.currency) || 'THB';
            const rate = currency === 'THB' ? 1 : Number(doc.exchangeRate || exchangeRates[currency]);
            if (!Number.isFinite(rate) || rate <= 0) throw new Error('invalid rate');
            row.netCents = cents(doc.subtotal, rate);
            row.vatCents = cents(doc.vat, rate);
        } catch { row.problem = 'ตรวจมูลค่าก่อนภาษี ยอด VAT หรืออัตราแลกเปลี่ยน'; }
        add(row);
    }

    for (const record of records) {
        const d = record.data;
        if (record.status !== 'reviewed' || d?.taxEligible !== true) continue;
        const row = {source:'vault', id:record.id, number:clean(d.documentNo), date:clean(d.documentDate),
            month:clean(d.reportMonth) || clean(d.documentDate).slice(0,7), party:clean(d.sellerName),
            taxId:sellerTaxId(d.sellerTaxId), branch:sellerBranch(d.sellerBranch)};
        const check = classifyVaultInputTax(record, {company, today});
        if (check.reason) { note([row], check.reason); continue; }
        row.netCents = check.netCents;
        row.vatCents = check.vatCents;
        add(row);
    }

    // Compare across periods before selecting the month, so a duplicate cannot appear in two months.
    for (const sameNumber of byNumber.values()) {
        if (!sameNumber.some(row => row.month === period)) continue;
        const incomplete = sameNumber.filter(row => !row.taxId || !row.branch);
        const ambiguous = new Set();
        for (const row of incomplete) for (const other of sameNumber) {
            if (row !== other && possiblySameInvoice(row, other)) { ambiguous.add(row); ambiguous.add(other); }
        }
        if (ambiguous.size) note([...ambiguous], 'พบเลขใบกำกับซ้ำ แต่ข้อมูลเลขภาษีหรือสาขาผู้ขายไม่ครบ');
        const exact = new Map();
        for (const row of sameNumber) {
            if (ambiguous.has(row)) continue;
            const key = row.taxId && row.branch ? `${row.taxId}:${row.branch}` : row;
            if (!exact.has(key)) exact.set(key, []);
            exact.get(key).push(row);
        }
        for (const group of exact.values()) {
            if (!group.some(row => row.month === period)) continue;
            const first = group[0];
            const problem = group.find(row => row.problem)?.problem;
            if (problem) { note(group, problem); continue; }
            if (group.some(row => row.month !== first.month || row.date !== first.date || row.netCents !== first.netCents || row.vatCents !== first.vatCents)) {
                note(group, 'เลขใบกำกับของผู้ขายและสาขาเดียวกัน แต่ยอด วันที่ หรือเดือนรายงานไม่ตรงกัน');
                continue;
            }
            const preferred = group.find(row => row.source === 'vault') || first;
            rows.push({...preferred, sources: [...new Set(group.map(row => row.source))]});
            duplicates += group.length - 1;
        }
    }
    rows.sort((a,b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number) || a.party.localeCompare(b.party));
    return {rows, issues, duplicates, netCents:rows.reduce((sum,row) => sum + row.netCents,0),
        vatCents:rows.reduce((sum,row) => sum + row.vatCents,0)};
}
