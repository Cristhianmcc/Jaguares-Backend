import mysql from 'mysql2/promise';

async function auditarDatos() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: '127.0.0.1',
      port: 3307,
      user: 'jaguares_user',
      password: 'jaguares_pass',
      database: 'jaguares_db',
      charset: 'utf8mb4'
    });

    console.log('✅ Conexión establecida\n');

    // 1. DEPORTES ACTIVOS
    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 DEPORTES ACTIVOS');
    console.log('═══════════════════════════════════════════════════════');
    const [deportes] = await connection.query(
      `SELECT deporte_id, nombre, icono FROM deportes WHERE estado='activo' ORDER BY nombre`
    );
    deportes.forEach(d => {
      console.log(`  ${d.deporte_id.toString().padEnd(3)} ${d.nombre.padEnd(30)} ${d.icono || ''}`);
    });
    console.log(`\nTotal deportes activos: ${deportes.length}\n`);

    // 2. CATEGORÍAS EXISTENTES
    console.log('═══════════════════════════════════════════════════════');
    console.log('📋 CATEGORÍAS EXISTENTES');
    console.log('═══════════════════════════════════════════════════════');
    const [categorias] = await connection.query(
      `SELECT c.categoria_id, c.deporte_id, d.nombre as deporte, c.nombre, c.descripcion, c.ano_min, c.ano_max 
       FROM categorias c 
       JOIN deportes d ON c.deporte_id = d.deporte_id 
       WHERE c.estado='activo' 
       ORDER BY d.nombre, c.orden`
    );
    let deporteActual = '';
    categorias.forEach(c => {
      if (c.deporte !== deporteActual) {
        deporteActual = c.deporte;
        console.log(`\n${deporteActual}:`);
      }
      console.log(`  ${c.categoria_id.toString().padStart(2)} | ${c.nombre.padEnd(15)} | ${c.ano_min}-${c.ano_max} | ${c.descripcion}`);
    });
    console.log(`\nTotal categorías: ${categorias.length}\n`);

    // 3. CATEGORÍAS USADAS EN HORARIOS
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚠️  ANÁLISIS DE HORARIOS');
    console.log('═══════════════════════════════════════════════════════');
    const [horariosCateg] = await connection.query(
      `SELECT DISTINCT h.categoria, h.año_min, h.año_max, d.nombre as deporte, COUNT(*) as cantidad
       FROM horarios h
       JOIN deportes d ON h.deporte_id = d.deporte_id
       WHERE h.estado='activo' AND h.categoria IS NOT NULL AND h.categoria != ''
       GROUP BY h.categoria, h.año_min, h.año_max, d.nombre
       ORDER BY d.nombre, h.categoria`
    );

    console.log('\n📌 Categorías usadas en horarios:');
    const categoriasExistentes = new Set(categorias.map(c => `${c.deporte}|${c.nombre}`));
    let problemas = [];
    
    deporteActual = '';
    horariosCateg.forEach(h => {
      if (h.deporte !== deporteActual) {
        deporteActual = h.deporte;
        console.log(`\n${deporteActual}:`);
      }
      const key = `${h.deporte}|${h.categoria}`;
      const existe = categoriasExistentes.has(key);
      const symbol = existe ? '✅' : '❌';
      console.log(`  ${symbol} ${h.categoria.padEnd(25)} (${h.año_min}-${h.año_max}) - ${h.cantidad} horarios`);
      
      if (!existe) {
        problemas.push({
          deporte: h.deporte,
          categoria: h.categoria,
          año_min: h.año_min,
          año_max: h.año_max,
          cantidad: h.cantidad
        });
      }
    });

    // 4. RESUMEN DE PROBLEMAS
    if (problemas.length > 0) {
      console.log('\n═══════════════════════════════════════════════════════');
      console.log('🔴 PROBLEMAS DETECTADOS');
      console.log('═══════════════════════════════════════════════════════');
      console.log(`\n${problemas.length} categorías usadas en horarios NO EXISTEN en tabla categorías:\n`);
      
      problemas.forEach((p, idx) => {
        console.log(`${(idx + 1).toString().padStart(2)}. ${p.deporte} - "${p.categoria}" (${p.año_min}-${p.año_max}) → ${p.cantidad} horarios afectados`);
      });

      // Agrupar por tipo de problema
      console.log('\n📊 Tipos de problemas:');
      const invertidos = problemas.filter(p => {
        const parts = p.categoria.split('-');
        if (parts.length === 2) {
          const [a, b] = parts.map(Number);
          return !isNaN(a) && !isNaN(b) && a > b;
        }
        return false;
      });
      
      const noExisten = problemas.filter(p => !invertidos.includes(p));
      
      if (invertidos.length > 0) {
        console.log(`\n  ⚠️  Nombres invertidos (${invertidos.length}):`);
        invertidos.forEach(p => console.log(`      "${p.categoria}" debería ser años ordenados de menor a mayor`));
      }
      
      if (noExisten.length > 0) {
        console.log(`\n  ❌ No existen en tabla categorías (${noExisten.length}):`);
        noExisten.forEach(p => console.log(`      ${p.deporte}: "${p.categoria}" (${p.año_min}-${p.año_max})`));
      }
    } else {
      console.log('\n✅ No se detectaron problemas - todos los horarios usan categorías válidas');
    }

    // 5. ESTADÍSTICAS
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📈 ESTADÍSTICAS');
    console.log('═══════════════════════════════════════════════════════');
    const [stats] = await connection.query(
      `SELECT 
        COUNT(DISTINCT deporte_id) as deportes_con_horarios,
        COUNT(*) as total_horarios,
        SUM(cupos_ocupados) as total_inscripciones
       FROM horarios 
       WHERE estado='activo'`
    );
    console.log(`Deportes con horarios: ${stats[0].deportes_con_horarios}`);
    console.log(`Total horarios activos: ${stats[0].total_horarios}`);
    console.log(`Total inscripciones: ${stats[0].total_inscripciones}`);

    console.log('\n✅ Auditoría completada');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

auditarDatos();
