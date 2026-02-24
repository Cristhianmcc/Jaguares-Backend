const mysql = require('mysql2/promise');
require('dotenv').config({ path: '../Jaguares-Backend.env' });
(async () => {
  const db = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const [a] = await db.execute(`SELECT alumno_id FROM alumnos WHERE dni='76325515'`);
  console.log('alumno:', a);
  if (!a.length) { await db.end(); return; }
  const id = a[0].alumno_id;
  const [ins] = await db.execute(`SELECT * FROM inscripciones WHERE alumno_id=?`, [id]);
  console.log('inscripciones:', JSON.stringify(ins, null, 2));
  const [ih] = await db.execute(`SELECT ih.*, d.nombre as deporte FROM inscripcion_horarios ih JOIN horarios h ON ih.horario_id=h.horario_id JOIN deportes d ON h.deporte_id=d.deporte_id JOIN inscripciones i ON ih.inscripcion_id=i.inscripcion_id WHERE i.alumno_id=?`, [id]);
  console.log('inscripcion_horarios:', JSON.stringify(ih, null, 2));
  await db.end();
})();
