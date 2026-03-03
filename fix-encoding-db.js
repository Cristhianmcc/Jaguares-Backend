/**
 * fix-encoding-db.js
 * Repara los datos corruptos en landing_texts (U+FFFD por tildes/ñ/©)
 * Ejecutar: node fix-encoding-db.js
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, 'server', '.env') });

const db = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3307,
  user: process.env.DB_USER || 'jaguares_user',
  password: process.env.DB_PASSWORD || 'jaguares_pass',
  database: process.env.DB_NAME || 'jaguares_db',
  charset: 'utf8mb4',
});

// Forzar utf8mb4 en esta sesión
await db.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
console.log('✅ Conexión con utf8mb4 establecida');

// ── DATOS CORRECTOS ──────────────────────────────────────────────────────────

const heroSlides = [
  {
    sport: 'Fútbol',
    title: 'Forjando\ncampeones',
    subtitle: 'Academia de Fútbol',
    description: 'Entrenamiento profesional para todas las edades con metodología de alto rendimiento.',
    accent: '#E03821'
  },
  {
    sport: 'Básquet',
    title: 'Alcanza nuevas\nalturas',
    subtitle: 'Programa Competitivo',
    description: 'Desarrolla técnica, estrategia y trabajo en equipo con nuestros entrenadores certificados.',
    accent: '#FF6B35'
  },
  {
    sport: 'Vóley',
    title: 'Potencia tu\njuego en red',
    subtitle: 'Formación Integral',
    description: 'Perfecciona tu saque, remate y bloqueo con metodología de alto rendimiento.',
    accent: '#4ECDC4'
  },
  {
    sport: 'Fútbol Femenino',
    title: 'El talento no\ntiene género',
    subtitle: 'Empoderamiento Deportivo',
    description: 'Programa exclusivo para desarrollar futbolistas de élite con pasión y determinación.',
    accent: '#E91E8C'
  },
  {
    sport: 'Funcional Mixto',
    title: 'Supera tus\nlímites',
    subtitle: 'Entrenamiento de Alto Impacto',
    description: 'Sesiones intensivas que combinan fuerza, resistencia y agilidad para todos los niveles.',
    accent: '#9B59B6'
  },
  {
    sport: 'Mamas Fit',
    title: 'Bienestar y\nenergía',
    subtitle: 'Programa Especial Mamás',
    description: 'Rutinas diseñadas para mamás activas que buscan mantenerse en forma y saludables.',
    accent: '#FF69B4'
  }
];

const deportes = [
  {
    categoria: 'Academia',
    fecha: 'Inscripciones Abiertas',
    titulo: 'Fútbol - Forja tu camino hacia el éxito',
    descripcion: 'Entrenamiento profesional con metodología de alto rendimiento para todas las edades. Desarrolla técnica, táctica y valores deportivos.',
    destacado: '1'
  },
  {
    categoria: 'Programa',
    fecha: 'Lunes y Miércoles',
    titulo: 'Básquet - Alcanza nuevas alturas',
    descripcion: 'Mejora tu juego en equipo y habilidades técnicas con nuestros entrenadores certificados.',
    destacado: '0'
  },
  {
    categoria: 'Formación',
    fecha: 'Martes y Jueves',
    titulo: 'Vóley - Potencia tu juego en red',
    descripcion: 'Perfecciona tu saque, remate y bloqueo con sesiones intensivas de entrenamiento.',
    destacado: '0'
  },
  {
    categoria: 'Bienestar',
    fecha: 'Horarios Flexibles',
    titulo: 'Funcional Mixto - Supera tus límites',
    descripcion: 'Sesiones que combinan fuerza, resistencia y agilidad para transformar tu condición física.',
    destacado: '0'
  }
];

const docentes = [
  { nombre: 'Leonardo',  especialidad: 'Fútbol'    },
  { nombre: 'Oscar',     especialidad: 'Fútbol'    },
  { nombre: 'Phaterson', especialidad: 'Funcional' },
  { nombre: 'Rafael',    especialidad: 'Vóley'     }
];

const estadisticas = {
  trofeos:  '256',
  partidos: '2548',
  gente:    '90+',
  anos:     '25+'
};

const cta = {
  titulo:     '¡Experimente la verdadera alegría de los juegos de fútbol profesional!',
  subtitulo:  'bienvenido',
  botonTexto: 'Inscríbete'
};

const general = {
  nombreClub: 'JAGUARES',
  copyright:  '© 2026 Jaguares F.C.',
  facebook:   'https://www.facebook.com/Jaguarezdegalvez',
  whatsapp:   'https://wa.me/51973324460'
};

// ── REPARACIÓN ────────────────────────────────────────────────────────────────

console.log('🗑  Eliminando datos corruptos de landing_texts...');
await db.query('DELETE FROM landing_texts');

const rows = [];

// Hero
for (let i = 0; i < heroSlides.length; i++) {
  const s = heroSlides[i];
  rows.push(['hero', i, 'sport',       s.sport]);
  rows.push(['hero', i, 'title',       s.title]);
  rows.push(['hero', i, 'subtitle',    s.subtitle]);
  rows.push(['hero', i, 'description', s.description]);
  rows.push(['hero', i, 'accent',      s.accent]);
}

// Deportes
for (let i = 0; i < deportes.length; i++) {
  const d = deportes[i];
  rows.push(['deportes', i, 'titulo',      d.titulo]);
  rows.push(['deportes', i, 'descripcion', d.descripcion]);
  rows.push(['deportes', i, 'categoria',   d.categoria]);
  rows.push(['deportes', i, 'fecha',       d.fecha]);
  rows.push(['deportes', i, 'destacado',   d.destacado]);
}

// Docentes
for (let i = 0; i < docentes.length; i++) {
  rows.push(['docentes', i, 'nombre',      docentes[i].nombre]);
  rows.push(['docentes', i, 'especialidad', docentes[i].especialidad]);
}

// Estadísticas
rows.push(['estadisticas', 0, 'trofeos',  estadisticas.trofeos]);
rows.push(['estadisticas', 0, 'partidos', estadisticas.partidos]);
rows.push(['estadisticas', 0, 'gente',    estadisticas.gente]);
rows.push(['estadisticas', 0, 'anos',     estadisticas.anos]);

// CTA
rows.push(['cta', 0, 'titulo',     cta.titulo]);
rows.push(['cta', 0, 'subtitulo',  cta.subtitulo]);
rows.push(['cta', 0, 'botonTexto', cta.botonTexto]);

// General
rows.push(['general', 0, 'nombreClub', general.nombreClub]);
rows.push(['general', 0, 'copyright',  general.copyright]);
rows.push(['general', 0, 'facebook',   general.facebook]);
rows.push(['general', 0, 'whatsapp',   general.whatsapp]);

console.log(`📝 Insertando ${rows.length} filas con UTF-8 correcto...`);
await db.query(
  'INSERT INTO landing_texts (section_slug, item_index, clave, valor) VALUES ?',
  [rows]
);

// ── VERIFICACIÓN ─────────────────────────────────────────────────────────────
console.log('\n🔍 Verificación rápida:');
const [check] = await db.query(
  "SELECT section_slug, clave, valor FROM landing_texts WHERE valor LIKE '%tbol%' OR valor LIKE '%nero%' OR valor LIKE '%lite%' LIMIT 6"
);
for (const r of check) {
  console.log(`  ${r.section_slug}.${r.clave} = "${r.valor}"`);
}

const [hasCorrupt] = await db.query(
  "SELECT COUNT(*) as n FROM landing_texts WHERE HEX(valor) LIKE '%EFBFBD%'"
);
console.log(hasCorrupt[0].n === 0
  ? '\n✅ ¡Sin caracteres de reemplazo! Datos reparados correctamente.'
  : `\n⚠️  Quedan ${hasCorrupt[0].n} filas con corrupción.`
);

await db.end();
console.log('Done.');
