const path = require('node:path');
module.exports = {
    content: [path.resolve(__dirname, '../../index.html'), path.resolve(__dirname, '../../*.mjs')],
    safelist: ['bg-emerald-500', 'bg-blue-500'],
    theme: { extend: {} },
    plugins: []
};
