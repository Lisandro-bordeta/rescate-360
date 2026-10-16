// Verificador de sintaxis: usa el stripping de tipos nativo de Node 24.
// No reemplaza a tsc (no valida tipos), pero detecta errores de sintaxis.
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const raices = [
  path.join(__dirname, 'backend', 'src'),
  path.join(__dirname, 'mobile', 'src'),
];

const archivos = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) archivos.push(full);
  }
};
raices.forEach(walk);
const appTsx = path.join(__dirname, 'mobile', 'App.tsx');
if (fs.existsSync(appTsx)) archivos.push(appTsx);

let ok = 0;
const errores = [];
for (const file of archivos) {
  const src = fs.readFileSync(file, 'utf8');
  const esTsx = file.endsWith('.tsx');
  try {
    if (esTsx) {
      // stripTypeScriptTypes no soporta JSX: validación básica de balance.
      const sinComentarios = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const abre = (sinComentarios.match(/[{([<]/g) || []).length;
      const cierra = (sinComentarios.match(/[})\]>]/g) || []).length;
      if (Math.abs(abre - cierra) > 3) throw new Error(`Balance de llaves sospechoso (${abre} vs ${cierra})`);
      ok++;
      continue;
    }
    const js = stripTypeScriptTypes(src, { mode: 'strip' });
    new vm.Script(js, { filename: file });
    ok++;
  } catch (err) {
    errores.push(`${path.relative(__dirname, file)}: ${err.message}`);
  }
}

console.log(`Verificados OK: ${ok}/${archivos.length}`);
if (errores.length) {
  console.log('\nERRORES:');
  errores.forEach((e) => console.log(' - ' + e));
  process.exit(1);
}
