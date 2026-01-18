import mysql from 'mysql2/promise';

const categorias = [
  // Fútbol
  { deporte_id: 1, nombre: '2019-2020', descripcion: 'Categoría 2019-2020 (4-5 años)', ano_min: 2019, ano_max: 2020, orden: 1 },
  { deporte_id: 1, nombre: '2017-2018', descripcion: 'Categoría 2017-2018 (6-7 años)', ano_min: 2017, ano_max: 2018, orden: 2 },
  { deporte_id: 1, nombre: '2015-2016', descripcion: 'Categoría 2015-2016 (8-9 años)', ano_min: 2015, ano_max: 2016, orden: 3 },
  { deporte_id: 1, nombre: '2013-2014', descripcion: 'Categoría 2013-2014 (10-11 años)', ano_min: 2013, ano_max: 2014, orden: 4 },
  { deporte_id: 1, nombre: '2011-2012', descripcion: 'Categoría 2011-2012 (12-13 años)', ano_min: 2011, ano_max: 2012, orden: 5 },
  { deporte_id: 1, nombre: '2009-2010', descripcion: 'Categoría 2009-2010 (14-15 años)', ano_min: 2009, ano_max: 2010, orden: 6 },
  
  // Fútbol Femenino
  { deporte_id: 2, nombre: 'Infantil', descripcion: 'Categoría Infantil (7-10 años)', ano_min: 2014, ano_max: 2017, orden: 1 },
  { deporte_id: 2, nombre: 'Juvenil', descripcion: 'Categoría Juvenil (11-14 años)', ano_min: 2010, ano_max: 2013, orden: 2 },
  { deporte_id: 2, nombre: 'Adolescente', descripcion: 'Categoría Adolescente (15-17 años)', ano_min: 2007, ano_max: 2009, orden: 3 },
  
  // Vóley
  { deporte_id: 3, nombre: 'Mini', descripcion: 'Categoría Mini (6-9 años)', ano_min: 2015, ano_max: 2018, orden: 1 },
  { deporte_id: 3, nombre: 'Pre-Infantil', descripcion: 'Categoría Pre-Infantil (10-11 años)', ano_min: 2013, ano_max: 2014, orden: 2 },
  { deporte_id: 3, nombre: 'Infantil', descripcion: 'Categoría Infantil (12-13 años)', ano_min: 2011, ano_max: 2012, orden: 3 },
  { deporte_id: 3, nombre: 'Cadete', descripcion: 'Categoría Cadete (14-15 años)', ano_min: 2009, ano_max: 2010, orden: 4 },
  
  // MAMAS FIT
  { deporte_id: 5, nombre: 'adulto +18', descripcion: 'Categoría adultos mayores de 18 años', ano_min: 1900, ano_max: 2008, icono: 'fitness_center', orden: 1 },
  
  // ASODE
  { deporte_id: 10, nombre: '2009-2010', descripcion: 'Categoría 2009-2010', ano_min: 2009, ano_max: 2010, orden: 1 },
  { deporte_id: 10, nombre: '2011-2012', descripcion: 'Categoría 2011-2012', ano_min: 2011, ano_max: 2012, orden: 2 },
  { deporte_id: 10, nombre: '2012-2013', descripcion: 'Categoría 2012-2013', ano_min: 2012, ano_max: 2013, orden: 3 },
  { deporte_id: 10, nombre: '2014', descripcion: 'Categoría 2014', ano_min: 2014, ano_max: 2014, orden: 4 },
  { deporte_id: 10, nombre: '2015-2016', descripcion: 'Categoría 2015-2016', ano_min: 2015, ano_max: 2016, orden: 5 },
  { deporte_id: 10, nombre: '2017', descripcion: 'Categoría 2017', ano_min: 2017, ano_max: 2017, orden: 6 },
  
  // Entrenamiento Funcional
  { deporte_id: 11, nombre: 'adulto +18', descripcion: 'Categoría adultos mayores de 18 años', ano_min: 1900, ano_max: 2008, icono: 'fitness_center', orden: 1 },
  
  // GYM JUVENIL
  { deporte_id: 12, nombre: '2005-2009', descripcion: 'Categoría 2005-2009 juvenil', ano_min: 2005, ano_max: 2009, icono: 'sports', orden: 1 },
  
  // Básquet
  { deporte_id: 17, nombre: '2017', descripcion: 'Categoría 2017', ano_min: 2017, ano_max: 2017, orden: 1 },
  { deporte_id: 17, nombre: '2015-2016', descripcion: 'Categoría 2015-2016', ano_min: 2015, ano_max: 2016, orden: 2 },
  { deporte_id: 17, nombre: '2014', descripcion: 'Categoría 2014', ano_min: 2014, ano_max: 2014, orden: 3 },
  { deporte_id: 17, nombre: '2012-2013', descripcion: 'Categoría 2012-2013', ano_min: 2012, ano_max: 2013, orden: 4 },
  { deporte_id: 17, nombre: '2011', descripcion: 'Categoría 2011', ano_min: 2011, ano_max: 2011, orden: 5 },
  { deporte_id: 17, nombre: '2010-2011', descripcion: 'Categoría 2010-2011', ano_min: 2010, ano_max: 2011, orden: 6 },
  { deporte_id: 17, nombre: '2010', descripcion: 'Categoría 2010', ano_min: 2010, ano_max: 2010, orden: 7 },
  { deporte_id: 17, nombre: '2009-2008', descripcion: 'Categoría 2009-2008', ano_min: 2008, ano_max: 2009, orden: 8 },
  { deporte_id: 17, nombre: '2009', descripcion: 'Categoría 2009', ano_min: 2009, ano_max: 2009, orden: 9 }
];

async function insertarCategorias() {
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

    console.log('✅ Conexión establecida');

    // Set character encoding
    await connection.query("SET NAMES 'utf8mb4'");
    await connection.query("SET CHARACTER SET utf8mb4");
    await connection.query("SET character_set_connection=utf8mb4");

    for (const cat of categorias) {
      try {
        const [result] = await connection.query(
          `INSERT INTO categorias (deporte_id, nombre, descripcion, ano_min, ano_max, icono, orden, estado) 
           VALUES (?, ?, ?, ?, ?, ?, ?, 'activo')`,
          [
            cat.deporte_id,
            cat.nombre,
            cat.descripcion,
            cat.ano_min,
            cat.ano_max,
            cat.icono || null,
            cat.orden
          ]
        );
        console.log(`✅ ${cat.nombre}`);
      } catch (error) {
        console.error(`❌ Error en ${cat.nombre}:`, error.message);
      }
    }

    // Verificar
    const [rows] = await connection.query('SELECT categoria_id, nombre, descripcion FROM categorias LIMIT 3');
    console.log('\n📋 Primeras 3 categorías:');
    rows.forEach(row => {
      console.log(`  ${row.categoria_id}: ${row.nombre} - ${row.descripcion}`);
    });

    console.log('\n✅ Proceso completado');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

insertarCategorias();
