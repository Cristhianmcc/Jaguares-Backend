import mysql from 'mysql2/promise';

// Categorías que faltan según la auditoría
const nuevasCategorias = [
  // Fútbol - Categorías faltantes
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2020-2021', descripcion: 'Categoría 2020-2021 (3-4 años)', ano_min: 2020, ano_max: 2021, orden: 0 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2018-2019', descripcion: 'Categoría 2018-2019 (5-6 años)', ano_min: 2018, ano_max: 2019, orden: 1 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2016-2017', descripcion: 'Categoría 2016-2017 (7-8 años)', ano_min: 2016, ano_max: 2017, orden: 2 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2014-2015', descripcion: 'Categoría 2014-2015 (9-10 años)', ano_min: 2014, ano_max: 2015, orden: 3 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2012-2013', descripcion: 'Categoría 2012-2013 (11-12 años)', ano_min: 2012, ano_max: 2013, orden: 4 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2010-2011', descripcion: 'Categoría 2010-2011 (13-14 años)', ano_min: 2010, ano_max: 2011, orden: 5 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2008-2009', descripcion: 'Categoría 2008-2009 (15-16 años)', ano_min: 2008, ano_max: 2009, orden: 6 },
  
  // Fútbol - Categorías individuales
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2019', descripcion: 'Categoría 2019 (5 años)', ano_min: 2019, ano_max: 2019, orden: 7 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2017', descripcion: 'Categoría 2017 (7 años)', ano_min: 2017, ano_max: 2017, orden: 8 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2016', descripcion: 'Categoría 2016 (8 años)', ano_min: 2016, ano_max: 2016, orden: 9 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2015', descripcion: 'Categoría 2015 (9 años)', ano_min: 2015, ano_max: 2015, orden: 10 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2014', descripcion: 'Categoría 2014 (10 años)', ano_min: 2014, ano_max: 2014, orden: 11 },
  
  // Fútbol - Categorías multi-año (agrupaciones especiales)
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2008-2009-2010-2011', descripcion: 'Categoría 2008-2011 (13-16 años)', ano_min: 2008, ano_max: 2011, orden: 12 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2009-2010-2011-2012', descripcion: 'Categoría 2009-2012 (12-15 años)', ano_min: 2009, ano_max: 2012, orden: 13 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2012-2013-2014', descripcion: 'Categoría 2012-2014 (10-12 años)', ano_min: 2012, ano_max: 2014, orden: 14 },
  { deporte: 'Fútbol', deporte_id: 1, nombre: '2013-2014-2015', descripcion: 'Categoría 2013-2015 (9-11 años)', ano_min: 2013, ano_max: 2015, orden: 15 },
  
  // Fútbol Femenino - Categoría amplia
  { deporte: 'Fútbol Femenino', deporte_id: 2, nombre: '2010-2015', descripcion: 'Categoría 2010-2015 (9-14 años)', ano_min: 2010, ano_max: 2015, orden: 4 },
  
  // Vóley - Categorías faltantes
  { deporte: 'Vóley', deporte_id: 3, nombre: '2015-2016', descripcion: 'Categoría 2015-2016 (8-9 años)', ano_min: 2015, ano_max: 2016, orden: 5 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2014', descripcion: 'Categoría 2014 (10 años)', ano_min: 2014, ano_max: 2014, orden: 6 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2013-2014', descripcion: 'Categoría 2013-2014 (10-11 años)', ano_min: 2013, ano_max: 2014, orden: 7 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2012-2013', descripcion: 'Categoría 2012-2013 (11-12 años)', ano_min: 2012, ano_max: 2013, orden: 8 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2011-2012', descripcion: 'Categoría 2011-2012 (12-13 años)', ano_min: 2011, ano_max: 2012, orden: 9 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2011', descripcion: 'Categoría 2011 (13 años)', ano_min: 2011, ano_max: 2011, orden: 10 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2010-2011', descripcion: 'Categoría 2010-2011 (13-14 años)', ano_min: 2010, ano_max: 2011, orden: 11 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2010', descripcion: 'Categoría 2010 (14 años)', ano_min: 2010, ano_max: 2010, orden: 12 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2009-2010', descripcion: 'Categoría 2009-2010 (14-15 años)', ano_min: 2009, ano_max: 2010, orden: 13 },
  { deporte: 'Vóley', deporte_id: 3, nombre: '2008-2009', descripcion: 'Categoría 2008-2009 (15-16 años)', ano_min: 2008, ano_max: 2009, orden: 14 },
];

// Mapeo de nombres invertidos a corregir en horarios
const correcionesNombres = {
  '2014-2013': '2013-2014',
  '2016-2015': '2015-2016',
  '2017-2016': '2016-2017',
  '2018-2017': '2017-2018',
  '2014-2013-2012': '2012-2013-2014',
  // Vóley
  '2009-2008': '2008-2009',
  '2010-2009': '2009-2010',
  '2011-2010': '2010-2011',
  '2012-2011': '2011-2012',
  '2013-2012': '2012-2013'
};

async function corregirDatos() {
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

    await connection.query("SET NAMES 'utf8mb4'");
    
    console.log('✅ Conexión establecida\n');

    // PASO 1: Crear categorías faltantes
    console.log('═══════════════════════════════════════════════════════');
    console.log('📝 PASO 1: CREAR CATEGORÍAS FALTANTES');
    console.log('═══════════════════════════════════════════════════════\n');
    
    for (const cat of nuevasCategorias) {
      try {
        const [result] = await connection.query(
          `INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, orden, estado) 
           VALUES (?, ?, ?, ?, ?, ?, 'activo')`,
          [cat.deporte_id, cat.nombre, cat.descripcion, cat.ano_min, cat.ano_max, cat.orden]
        );
        console.log(`✅ ${cat.deporte.padEnd(20)} | ${cat.nombre.padEnd(25)} | ${cat.ano_min}-${cat.ano_max}`);
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          console.log(`⏭️  ${cat.deporte.padEnd(20)} | ${cat.nombre.padEnd(25)} | Ya existe`);
        } else {
          console.error(`❌ Error en ${cat.nombre}:`, error.message);
        }
      }
    }

    console.log(`\n✅ ${nuevasCategorias.length} categorías procesadas\n`);

    // PASO 2: Corregir nombres invertidos en horarios
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔧 PASO 2: CORREGIR NOMBRES INVERTIDOS EN HORARIOS');
    console.log('═══════════════════════════════════════════════════════\n');
    
    for (const [incorrecto, correcto] of Object.entries(correcionesNombres)) {
      const [result] = await connection.query(
        `UPDATE horarios SET categoria = ? WHERE categoria = ? AND estado='activo'`,
        [correcto, incorrecto]
      );
      if (result.affectedRows > 0) {
        console.log(`✅ "${incorrecto}" → "${correcto}" (${result.affectedRows} horarios actualizados)`);
      }
    }

    console.log('\n✅ Correcciones aplicadas\n');

    // PASO 3: Verificar horarios sin categoría válida
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔍 PASO 3: VERIFICACIÓN FINAL');
    console.log('═══════════════════════════════════════════════════════\n');
    
    const [horariosProblema] = await connection.query(`
      SELECT h.horario_id, d.nombre as deporte, h.dia, h.hora_inicio, h.categoria, h.año_min, h.año_max
      FROM horarios h
      JOIN deportes d ON h.deporte_id = d.deporte_id
      LEFT JOIN categorias c ON h.categoria = c.nombre AND h.deporte_id = c.deporte_id AND c.estado='activo'
      WHERE h.estado='activo' 
        AND h.categoria IS NOT NULL 
        AND h.categoria != ''
        AND c.categoria_id IS NULL
      ORDER BY d.nombre, h.categoria
    `);

    if (horariosProblema.length > 0) {
      console.log(`⚠️  ${horariosProblema.length} horarios aún sin categoría válida:\n`);
      horariosProblema.forEach(h => {
        console.log(`  ${h.horario_id.toString().padStart(3)} | ${h.deporte.padEnd(25)} | ${h.dia.padEnd(10)} ${h.hora_inicio} | "${h.categoria}"`);
      });
    } else {
      console.log('✅ TODOS los horarios tienen categorías válidas');
    }

    // Estadísticas finales
    const [stats] = await connection.query(`
      SELECT 
        (SELECT COUNT(*) FROM categorias WHERE estado='activo') as total_categorias,
        (SELECT COUNT(*) FROM horarios WHERE estado='activo') as total_horarios,
        (SELECT COUNT(*) FROM horarios h 
         JOIN categorias c ON h.categoria = c.nombre AND h.deporte_id = c.deporte_id 
         WHERE h.estado='activo' AND c.estado='activo') as horarios_con_categoria_valida
    `);

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📊 ESTADÍSTICAS FINALES');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Total categorías activas: ${stats[0].total_categorias}`);
    console.log(`Total horarios activos: ${stats[0].total_horarios}`);
    console.log(`Horarios con categoría válida: ${stats[0].horarios_con_categoria_valida}`);
    const porcentaje = ((stats[0].horarios_con_categoria_valida / stats[0].total_horarios) * 100).toFixed(1);
    console.log(`Porcentaje validado: ${porcentaje}%`);

    console.log('\n✅ Proceso completado');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

corregirDatos();
