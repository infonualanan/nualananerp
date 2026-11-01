const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const output = path.resolve(__dirname, '../../assets');
fs.mkdirSync(output, {recursive:true});
execFileSync(process.execPath, [require.resolve('tailwindcss/lib/cli.js'), '-c', path.join(__dirname, 'tailwind.config.cjs'), '-i', path.join(__dirname, 'input.css'), '-o', path.join(output, 'erp-tailwind-3.4.17.css'), '--minify'], {stdio:'inherit', cwd:__dirname});
const phosphor = path.join(__dirname, 'node_modules/@phosphor-icons/web');
const css = fs.readFileSync(path.join(phosphor, 'src/regular/style.css'), 'utf8')
    .replace(/@font-face\s*\{[\s\S]*?\}/, '@font-face {font-family:"Phosphor";src:url("./phosphor-regular-2.1.2.woff2") format("woff2");font-weight:normal;font-style:normal;font-display:swap;}');
fs.writeFileSync(path.join(output, 'phosphor-2.1.2.css'), css);
fs.copyFileSync(path.join(phosphor, 'src/regular/Phosphor.woff2'), path.join(output, 'phosphor-regular-2.1.2.woff2'));
fs.copyFileSync(path.join(phosphor, 'LICENSE'), path.join(output, 'PHOSPHOR-LICENSE.txt'));
fs.copyFileSync(path.join(__dirname, 'node_modules/tailwindcss/LICENSE'), path.join(output, 'TAILWIND-LICENSE.txt'));
