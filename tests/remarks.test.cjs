// Run with: node --test tests/remarks.test.cjs (no external dependencies).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const remarksCode = html.slice(html.indexOf('        // Remark editing and duplicate checks'), html.indexOf('        // End shared remark editing.'));
const submitCode = html.slice(html.indexOf("        if($('create-doc-form'))"), html.indexOf('        function updateDashboard()'));
const numberingCode = html.slice(html.indexOf('        function generateDocNo('), html.indexOf("        if($('create-doc-form'))"));
const documentConfig = html.slice(html.indexOf('        const docTypeNames ='), html.indexOf('        const translations ='));
const turn = () => new Promise(resolve => setImmediate(resolve));

class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.value = ''; this.dataset = {}; this.style = {}; this.listeners = {}; this.disabled = false; this.className = ''; this._text = ''; this.open = false; this.hidden = false; this.classList = { add() {}, remove() {}, contains() { return false; } }; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set innerHTML(value) { this.textContent = value; }
    get innerHTML() { return this.textContent; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this._text = ''; this.children = children; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { return Promise.all((this.listeners[type] || []).map(fn => fn.call(this, { preventDefault() {} }))); }
    descendants() { return this.children.flatMap(c => [c, ...c.descendants()]); }
    querySelectorAll(selector) { return this.descendants().filter(c => selector.split(',').some(sel => { sel = sel.trim(); return sel.startsWith('.') ? c.className.split(' ').includes(sel.slice(1)) : c.tagName === sel; })); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { this.focused = true; }
    scrollIntoView() {}
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; queueMicrotask(() => this.dispatch('close')); } }
    reset() { this.didReset = true; }
}
function setup(initial = []) {
    const nodes = new Map();
    for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)) nodes.set(match[2], new Element(match[1]));
    const $ = id => nodes.get(id) || null;
    const document = {
        createElement: tag => new Element(tag),
        querySelectorAll(selector) {
            if (selector === '.item-row') return [];
            return selector.split(',').flatMap(part => {
                const [root, ...child] = part.trim().split(/\s+/);
                if (!root.startsWith('#')) return [];
                const el = $(root.slice(1)); return el ? child.length ? el.querySelectorAll(child.join(' ')) : [el] : [];
            });
        }
    };
    $('doc-remark-editor').append($('doc-remark-text'), $('doc-remark-save'), $('doc-remark-cancel'));
    $('add-remark-form').append($('new-remark-text'), $('btn-add-remark'), $('btn-cancel-remark'));
    $('create-doc-form').append($('doc-remark-editor'), $('doc-type'), $('customer-select'), $('doc-date'));
    $('doc-type').value = 'QT'; $('customer-select').value = 'customer-1';
    const server = new Map(initial.map(note => [note.id, { ...note }])); const writes = [], alerts = [];
    const behavior = { failRead: false, failWrite: false, readGate: null };
    const context = vm.createContext({ document, $, crypto: { randomUUID }, setTimeout: () => 0, console: { error() {} },
        val: id => $(id)?.value || '', txt: (id, text) => { $(id).textContent = text; }, show: (id, yes) => { $(id).hidden = !yes; },
        showAlert: text => alerts.push(text), showConfirm: (_text, yes) => yes(), checkUpcomingEmployeeLeave() {},
        getUserCol: collection => ({ collection }), getUserDoc: (collection, id) => ({ collection, id }),
        getDocsFromServer: async () => { if (behavior.readGate) await behavior.readGate; if (behavior.failRead) throw new Error('offline'); return { docs: [...server.values()].map(note => ({ id: note.id, data: () => ({ ...note }) })) }; },
        getDoc: async ref => ({ exists: () => server.has(ref.id), data: () => server.get(ref.id) }),
        setDoc: async (ref, data) => { if (behavior.failWrite === true || behavior.failWrite === ref.collection) throw new Error('permission-denied'); writes.push({ ...ref, data: JSON.parse(JSON.stringify(data)) }); if (ref.collection === 'savedRemarks') server.set(ref.id, { ...data }); },
        deleteDoc: async ref => server.delete(ref.id), serverTimestamp: () => 'server-time',
        formatDateEng: date => date, formatDateThai: date => date, checkDocType() {}, addLineItem() {}, switchTab() {},
    });
    vm.runInContext(`
        let currentUser = { uid: 'user-1' }, currentLang = 'th';
        let savedRemarks = ${JSON.stringify(initial)}, editingRemarkId = null, editingDocRemarkId = null;
        let remarkSaveInProgress = false, documentSaveInProgress = false, remarksLoaded = true, remarksDataUserId = 'user-1';
        const remarkEditorBaseline = { document: '', settings: '' }, selectedRemarkTexts = new Map();
        let selectedRemarksSequence = [], remarkChoiceResolver = null;
        let database = [], customers = [{ id:'customer-1',name:'Customer',taxId:'',branch:'',address:'',email:'' }], employees = [], exchangeRates = {};
        ${documentConfig}\n${remarksCode}\n${numberingCode}\n${submitCode}
    `, context);
    return { $, server, writes, alerts, behavior, run: code => vm.runInContext(code, context), submit: () => $('create-doc-form').dispatch('submit') };
}
const term = 'ยืนยันการสั่งซื้อด้วยใบเสนอราคาฉบับนี้ หรือใบสั่งซื้อเท่านั้น\nชำระเงิน 60% ณ วันสั่งซื้อ และ 40% ณ วันรับสินค้า';
const changed = term.replace('60%', '50%').replace('40%', '50%');
const initial = [{ id: 'a', text: term }, { id: 'b', text: 'กรุณาตรวจสอบสินค้าให้ครบถ้วนก่อนลงนามรับสินค้า' }];

test('inline addition saves multiline text to library and selects it only after success', async () => {
    const h=setup(initial); h.$('doc-remark-text').value='ที่อยู่จัดส่ง\n99/1 หมู่ 2';
    assert.equal(await h.run("saveRemark('document')"), true);
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].collection,'savedRemarks');
    assert.equal(h.run('getSelectedRemarkEntries()[0].text'),'ที่อยู่จัดส่ง\n99/1 หมู่ 2');
    assert.equal(h.$('doc-remark-text').value,'');
});
test('editing an existing inline note updates its id, excludes itself and preserves saved document snapshots', async () => {
    const h=setup(initial); h.run("database=[{remark:'previous saved text'}]; editRemark('a','document')");
    h.$('doc-remark-text').value=changed;
    assert.equal(await h.run("saveRemark('document')"),true); assert.equal(h.writes[0].id,'a');
    assert.equal(h.server.size,2); assert.equal(h.run('database[0].remark'),'previous saved text');
});
test('library addition still works and does not select a note in the document', async () => {
    const h=setup(initial); h.$('new-remark-text').value='ติดต่อคลังสินค้าเพื่อกำหนดวันเข้ารับ';
    assert.equal(await h.run("saveRemark('settings')"),true); assert.equal(h.run('selectedRemarksSequence.length'),0);
});
test('similar warning requires a choice and cancellation keeps all draft text', async () => {
    const h=setup(initial); h.$('doc-remark-text').value=changed;
    const pending=h.run("saveRemark('document')"); await turn();
    assert.equal(h.$('remark-duplicate-dialog').open,true); assert.equal(h.writes.length,0);
    h.run('resolveRemarkChoice(null)'); assert.equal(await pending,false);
    assert.equal(h.$('doc-remark-text').value,changed); assert.equal(h.$('doc-remark-save').disabled,false);
});
test('exact duplicates offer existing text without creating a record', async () => {
    const h=setup(initial); h.$('doc-remark-text').value=term;
    const pending=h.run("saveRemark('document')"); await turn();
    assert.equal(h.$('remark-duplicate-copy').hidden,true);
    h.run("resolveRemarkChoice({type:'existing',note:savedRemarks[0]})");
    assert.equal(await pending,true); assert.equal(h.writes.length,0); assert.equal(h.run('selectedRemarksSequence[0]'),'a');
});
test('similar text can be kept as a separate note without overwriting original terms', async () => {
    const h=setup(initial); h.$('doc-remark-text').value=changed;
    const pending=h.run("saveRemark('document')"); await turn(); h.run("resolveRemarkChoice({type:'copy'})");
    assert.equal(await pending,true); assert.equal(h.server.get('a').text,term); assert.equal(h.server.size,3);
});
test('failure to read latest library or write data keeps user input and unlocks controls', async () => {
    for (const failure of ['failRead','failWrite']) {
        const h=setup(); h.behavior[failure]=true; h.$('doc-remark-text').value='ข้อความที่ยังต้องเก็บไว้';
        assert.equal(await h.run("saveRemark('document')"),false);
        assert.equal(h.$('doc-remark-text').value,'ข้อความที่ยังต้องเก็บไว้'); assert.equal(h.$('doc-remark-save').disabled,false);
        assert.equal(h.run('selectedRemarksSequence.length'),0);
    }
});
test('repeated save clicks result in one write', async () => {
    const h=setup(); let release; h.behavior.readGate=new Promise(r=>release=r); h.$('doc-remark-text').value='ส่งทางรถขนส่ง';
    const one=h.run("saveRemark('document')"); assert.equal(await h.run("saveRemark('document')"),false);
    release(); await one; assert.equal(h.writes.length,1);
});
test('blank notes and a library that is still loading cannot be saved', async () => {
    const h=setup(); assert.equal(await h.run("saveRemark('document')"),false);
    h.$('doc-remark-text').value='ข้อความ'; h.run('remarksLoaded=false'); assert.equal(await h.run("saveRemark('document')"),false);
    assert.equal(h.writes.length,0);
});
test('percentage changes are similar but not identical; numeric signs and decimal separators remain significant', () => {
    const h=setup(initial); assert.ok(h.run(`remarkSimilarity(${JSON.stringify(term)},${JSON.stringify(changed)})`)>.74);
    assert.equal(h.run(`findSimilarRemarks(${JSON.stringify(changed)})[0].exact`),false);
    assert.notEqual(h.run("normalizeRemark('1.5%')"),h.run("normalizeRemark('15%')"));
    assert.notEqual(h.run("normalizeRemark('-5')"),h.run("normalizeRemark('5')"));
    assert.equal(h.run("normalizeRemark(' A   B\n')".replace('\n','\\n')),'a b');
});
test('loading older documents preserves saved text even after the library changes or deletes it', () => {
    const h=setup(initial); h.run("restoreDocumentRemarks({docNo:'QT-2026-001',remark:'1. original terms\\n2. old address',remarkIds:['a']})");
    assert.equal(h.run('formatRemarkEntries(getSelectedRemarkEntries())'),'1. original terms\n2. old address');
    h.run('savedRemarks=[]; renderRemarksCheckboxes()'); assert.equal(h.run('getSelectedRemarkEntries().length'),1);
});
test('loading per-note snapshots does not substitute new library text', () => {
    const h=setup(initial); h.run("restoreDocumentRemarks({remarkEntries:[{id:'a',text:'old saved terms'}]})");
    assert.equal(h.run('getSelectedRemarkEntries()[0].text'),'old saved terms');
});
test('a leading address or percentage is never stripped when numbering notes', () => {
    const h=setup(); assert.equal(h.run("formatRemarkEntries([{text:'60% มัดจำ'},{text:'21/24 ถนนเพชรบุรี'}])"),'1. 60% มัดจำ\n2. 21/24 ถนนเพชรบุรี');
});
test('library changes during editing stop an overwrite and keep the edited draft', async () => {
    const h=setup(initial); h.run("editRemark('a','document')"); h.$('doc-remark-text').value=changed;
    h.server.set('a',{id:'a',text:'terms changed by another editor'});
    assert.equal(await h.run("saveRemark('document')"),false); assert.equal(h.writes.length,0); assert.equal(h.$('doc-remark-text').value,changed);
});
test('switching accounts during the server read cannot write or select another user’s note', async () => {
    const h=setup(); let release; h.behavior.readGate=new Promise(r=>release=r); h.$('doc-remark-text').value='private draft';
    const pending=h.run("saveRemark('document')"); h.run("currentUser={uid:'user-2'};resetRemarkSession()"); release();
    assert.equal(await pending,false); assert.equal(h.writes.length,0); assert.equal(h.run('selectedRemarksSequence.length'),0);
});
test('note text is inserted as text, not interpreted as HTML', () => {
    const h=setup([{id:'x',text:'<img src=x onerror=alert(1)>'}]); h.run('renderSettingsRemarks(); renderRemarksCheckboxes()');
    assert.ok(h.$('settings-remarks-list').textContent.includes('<img src=x onerror=alert(1)>'));
    assert.equal(h.$('settings-remarks-list').querySelectorAll('img').length,0);
});
test('document submit saves an unsaved note first, then includes its text and snapshot', async () => {
    const h=setup(); h.$('doc-remark-text').value='หมายเหตุที่พิมพ์แล้วกดบันทึกเอกสารเลย'; await h.submit();
    assert.deepEqual(h.writes.map(w=>w.collection),['savedRemarks','documents']);
    assert.equal(h.writes[1].data.remark,'1. หมายเหตุที่พิมพ์แล้วกดบันทึกเอกสารเลย');
    assert.equal(h.writes[1].data.remarkEntries[0].text,'หมายเหตุที่พิมพ์แล้วกดบันทึกเอกสารเลย');
    assert.equal(h.writes[1].data.inputDate,''); assert.equal(h.writes[1].data.creditTerm,'');
});
test('canceling similarity warning during document save prevents both writes', async () => {
    const h=setup(initial); h.$('doc-remark-text').value=changed; const pending=h.submit(); await turn();
    h.run('resolveRemarkChoice(null)'); await pending;
    assert.equal(h.writes.length,0); assert.equal(h.$('doc-remark-text').value,changed);
    assert.equal(h.run('documentSaveInProgress'),false); assert.equal(h.$('doc-type').disabled,false);
});
test('failed document write retains selected note; retry does not add another library note', async () => {
    const h=setup(); h.$('doc-remark-text').value='ข้อความสำหรับ retry'; h.behavior.failWrite='documents'; await h.submit();
    assert.equal(h.writes.length,1); assert.equal(h.run('selectedRemarksSequence.length'),1); assert.equal(h.$('create-doc-form').didReset,undefined);
    h.behavior.failWrite=false; await h.submit(); assert.equal(h.writes.length,2); assert.equal(h.server.size,1);
});
test('all existing document types retain blank date and credit support with note snapshots', async () => {
    const h=setup(); const types=h.run('Object.keys(docTypeNames)');
    for (const type of types) { h.$('doc-type').value=type; h.$('doc-date').value=''; await h.submit(); }
    assert.equal(h.writes.filter(w=>w.collection==='documents').length,37);
    for (const write of h.writes) { assert.equal(write.data.inputDate,''); assert.equal(write.data.creditTerm,''); assert.ok(Array.isArray(write.data.remarkEntries)); h.$('doc-date').value=''; }
});
