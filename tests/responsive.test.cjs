// npm --prefix tests ci && npm --prefix tests test
// DOM integration tests use isolated data and never contact Firebase.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const controller = html.match(/<script id="erp-responsive-behavior">([\s\S]*?)<\/script>/)[1];
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const turn = () => new Promise(resolve => setImmediate(resolve));

function setup(t) {
    const dom = new JSDOM(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://offline.test/' });
    t.after(() => dom.window.close());
    const w = dom.window, $ = id => w.document.getElementById(id);
    const listeners = [];
    const media = { matches: true, addEventListener: (_type, fn) => listeners.push(fn) };
    w.matchMedia = () => media;
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
    w.eval(controller);
    let offline = source.replace(/^\s*import .*?;\s*$/gm, '');
    const start = offline.indexOf('        // --- Firebase Configuration & Initialization ---');
    const end = offline.indexOf('        // Login Feature', start);
    offline = offline.slice(0, start) + `
        const auth = {}, db = {}, appId = 'offline-test';
        let currentUser = {uid: 'offline'};
        const getUserCol = name => name, getUserDoc = (name, id) => name + '/' + id;
        const setDoc = async (ref, data) => { window.testWrites.push({ref, data}); if(window.testWriteGate) await window.testWriteGate; };
        const deleteDoc = async () => {}, serverTimestamp = () => null;
        const getDocsFromServer = async () => ({docs: []});
    ` + offline.slice(end);
    w.testWrites = [];
    w.eval(offline + `
        customers = [{id:'test-customer',name:'ลูกค้าทดสอบ',code:'C001'}];
        employees = []; savedRemarks = []; remarksLoaded = true; remarksDataUserId = 'offline';
        $('login-screen').style.display = 'none'; $('main-app').style.display = 'flex';
        renderCustomerDropdown(false); switchTab('create-doc');
    `);
    const resize = width => { media.matches = width < 1200; listeners.forEach(fn => fn({matches:media.matches})); w.dispatchEvent(new w.Event('resize')); };
    return {w, $, resize};
}

test('mobile drawer traps navigation, closes on Escape, and restores the draft', async t => {
    const {w,$} = setup(t);
    $('doc-remark-text').value = 'หมายเหตุที่ยังไม่บันทึก';
    assert.equal($('erp-sidebar').inert, true);
    $('erp-menu-open').click();
    assert.equal($('erp-content').inert, true);
    assert.equal($('erp-sidebar').inert, false);
    assert.equal($('erp-sidebar').getAttribute('aria-modal'), 'true');
    assert.equal(w.document.activeElement, $('erp-menu-close'));
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
    assert.equal($('erp-content').inert, false);
    assert.equal($('erp-menu-backdrop').hidden, true);
    assert.equal(w.document.activeElement, $('erp-menu-open'));
    assert.equal($('doc-remark-text').value, 'หมายเหตุที่ยังไม่บันทึก');
});

test('crossing desktop breakpoint restores sidebar and keeps all form values', t => {
    const {w,$,resize} = setup(t);
    const name = w.document.querySelector('.item-name'); name.value = 'รายการที่กำลังแก้';
    $('doc-ref-manual').value = 'REF-123'; $('erp-menu-open').click();
    resize(1440);
    assert.equal($('erp-sidebar').inert, false);
    assert.equal($('erp-sidebar').hasAttribute('aria-hidden'), false);
    assert.equal($('erp-content').inert, false);
    resize(820);
    assert.equal($('erp-sidebar').inert, true);
    assert.equal(name.value, 'รายการที่กำลังแก้');
    assert.equal($('doc-ref-manual').value, 'REF-123');
});

test('mobile action bar follows tab, totals, language, currency and disabled save state', async t => {
    const {w,$} = setup(t); await turn();
    assert.equal($('mobile-doc-actions').hidden, false);
    assert.equal($('mobile-doc-save').form, $('create-doc-form'));
    $('live-grand').textContent = '2,140.00'; $('doc-save-button').disabled = true;
    $('doc-currency').value = 'USD'; $('doc-currency').dispatchEvent(new w.Event('change'));
    await turn();
    assert.equal($('mobile-doc-total').textContent, '2,140.00');
    assert.equal($('mobile-doc-save').disabled, true);
    assert.match($('mobile-total-label').textContent, /USD/);
    w.switchTab('customers'); await turn();
    assert.equal($('mobile-doc-actions').hidden, true);
    $('doc-save-button').disabled = false;
    w.switchTab('create-doc'); w.toggleLanguage(); await turn();
    assert.equal($('mobile-doc-actions').hidden, false);
    assert.equal($('mobile-doc-save').disabled, false);
    assert.equal($('mobile-doc-save').textContent, $('doc-save-button').textContent.trim());
    assert.match($('mobile-total-label').textContent, /Net total/);
});

test('card line items keep accessible fields and recalculation after adding and deleting rows', async t => {
    const {w,$} = setup(t);
    w.addLineItem({code:'G001',name:'ตัวอย่าง',qty:2,unit:'ชิ้น',price:100,discVal:10});
    w.calculateLiveTotal(); await turn();
    const row = $('items-container').lastElementChild;
    assert.equal(row.querySelector('.item-name').getAttribute('aria-label'), 'รายละเอียด');
    assert.equal(row.querySelector('.item-row-total').textContent, '180.00');
    assert.equal(row.querySelector('.item-row-total').dataset.fieldLabel, 'รวมเงิน');
    assert.equal($('mobile-doc-total').textContent, '180.00');
    w.labelResponsiveLineItem(row); w.labelResponsiveLineItem(row);
    assert.equal(row.querySelectorAll('.mobile-field-label').length, 6);
    row.remove(); w.calculateLiveTotal(); await turn();
    assert.equal($('mobile-doc-total').textContent, '0.00');
});

test('rendered record cards receive column labels including newly replaced rows', async t => {
    const {w,$} = setup(t);
    w.switchTab('customers'); await turn();
    const body = $('customers-table-body');
    assert.ok(body.closest('table').classList.contains('responsive-records'));
    assert.equal(body.rows[0].cells[0].dataset.label, body.closest('table').querySelector('th').textContent.trim());
    body.innerHTML = '<tr><td colspan="8">ไม่มีข้อมูล</td></tr>'; await turn();
    assert.equal(body.rows[0].cells[0].dataset.label, '');
    w.switchTab('customers'); await turn();
    assert.ok(body.rows[0].cells[1].dataset.label);
});

test('preview fits mobile and tablet, respects manual zoom, and preserves A4 paper dimensions', t => {
    const {w,$} = setup(t);
    const area = $('preview-scroll-area'), paper = $('paper-preview');
    let width = 390;
    Object.defineProperty(area, 'clientWidth', {get: () => width});
    Object.defineProperty(paper, 'offsetWidth', {get: () => 794});
    $('preview-scroll-content').style.padding = '12px';
    $('document-preview-modal').classList.remove('hidden');
    w.fitDocumentPreview(true);
    const scale = Number(paper.style.transform.match(/[\d.]+/)[0]);
    assert.ok(scale > .4 && scale < .5);
    assert.ok(794 * scale <= width - 24);
    assert.equal(paper.style.width, '210mm'); assert.equal(paper.style.height, '297mm');
    w.updatePreviewScale(1); width = 820; w.fitDocumentPreview();
    assert.equal(paper.style.transform, 'scale(1)');
    w.fitDocumentPreview(true);
    assert.equal(paper.style.transform, 'scale(0.8)');
    assert.equal(paper.style.width, '210mm'); assert.equal(paper.style.height, '297mm');
});

test('external mobile submit uses native required validation and prevents duplicate document saves', async t => {
    const {w,$} = setup(t); await turn();
    let submitted = 0;
    $('create-doc-form').addEventListener('submit', () => submitted++);
    $('mobile-doc-save').click(); await turn();
    assert.equal(submitted, 0); assert.equal(w.testWrites.length, 0);
    $('doc-type').value = 'QT'; w.checkDocType();
    $('customer-select').value = 'test-customer';
    w.document.querySelector('.item-name').value = 'รายการทดสอบ';
    let release; w.testWriteGate = new Promise(resolve => { release = resolve; });
    $('mobile-doc-save').click(); await turn();
    assert.equal(submitted, 1); assert.equal(w.testWrites.length, 1);
    assert.equal($('mobile-doc-save').disabled, true);
    $('mobile-doc-save').click(); await turn();
    assert.equal(w.testWrites.length, 1);
    release(); await turn(); await turn();
    assert.equal($('mobile-doc-save').disabled, false);
});
