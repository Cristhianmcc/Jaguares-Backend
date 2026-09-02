export const DEFAULT_LANDING_STRUCTURE = [
  { section_slug: 'hero',         orden: 10, visible: 1, label: 'Portada / Carrusel' },
  { section_slug: 'deportes',     orden: 20, visible: 1, label: 'Deportes' },
  { section_slug: 'ranking',      orden: 30, visible: 1, label: 'Ranking' },
  { section_slug: 'galeria',      orden: 40, visible: 1, label: 'Galería' },
  { section_slug: 'docentes',     orden: 50, visible: 1, label: 'Docentes' },
  { section_slug: 'estadisticas', orden: 60, visible: 1, label: 'Sobre nosotros' },
  { section_slug: 'cta',          orden: 70, visible: 1, label: 'Contacto' },
  { section_slug: 'footer',       orden: 80, visible: 1, label: 'Pie de página' },
];

const DEFAULT_NAV_LINKS = [
  { id: 'inicio', label: 'Inicio', href: '/' },
  { id: 'deportes', label: 'Disciplinas', href: '#disciplinas' },
  { id: 'ranking', label: 'Ranking', href: '#ranking' },
  { id: 'galeria', label: 'Galería', href: '#galeria' },
  { id: 'docentes', label: 'Docentes', href: '#docentes' },
  { id: 'nosotros', label: 'Nosotros', href: '#nosotros' },
  { id: 'contacto', label: 'Contacto', href: '#contacto' },
  { id: 'consulta', label: 'Consultar estado', href: '/consulta' },
  { id: 'intranet', label: 'Intranet', href: '/admin-login' },
];

const copy = (value) => JSON.parse(JSON.stringify(value));

export const DEFAULT_CMS_CONTENT = {
  navegacion: {
    nombreClub: 'JAGUARES',
    logo: '/assets/logo.ico',
    links: DEFAULT_NAV_LINKS,
    botonTexto: 'Inscríbete',
    botonEnlace: '/inscripcion',
  },
  heroConfig: {
    antetitulo: 'Escuela Deportiva Jaguares',
    botonPrimarioTexto: 'Ver disciplinas',
    botonPrimarioEnlace: '#disciplinas',
    botonSecundarioTexto: 'Inscríbete ahora',
    botonSecundarioEnlace: '/inscripcion',
  },
  encabezados: {
    deportes: { antetitulo: 'Nuestras disciplinas', titulo: 'Elige tu', destacado: 'Deporte', enlaceTexto: 'Ver categorías y horarios →' },
    ranking: { antetitulo: 'Tabla de posiciones', titulo: 'Ranking de', destacado: 'Alumnos', puestoTexto: '#', alumnoTexto: 'Alumno', disciplinaTexto: 'Disciplina', puntosTexto: 'Puntos' },
    galeria: { antetitulo: 'Nuestra comunidad', titulo: 'Galería', destacado: 'Jaguares' },
    docentes: { antetitulo: 'Nuestro equipo', titulo: 'Conoce a nuestros', destacado: 'Docentes' },
  },
  hero: { slides: [] },
  deportes: [],
  docentes: [],
  galeria: { items: [], botonTexto: 'Síguenos en Facebook', botonEnlace: '#' },
  estadisticas: {},
  cta: {
    titulo: 'SÚMATE A\nJAGUARES',
    descripcion: 'Empieza hoy tu camino deportivo. Inscripciones abiertas para todas las disciplinas.',
    botonTexto: 'Inscríbete ahora',
    botonEnlace: '/inscripcion',
    ubicacionEtiqueta: 'Ubicación',
    telefonoEtiqueta: 'Teléfono',
    emailEtiqueta: 'Email',
  },
  general: {
    nombreClub: 'JAGUARES',
    copyright: '',
    instagram: '#',
    facebook: '#',
    whatsapp: '#',
    instagramTexto: 'Instagram',
    facebookTexto: 'Facebook',
    whatsappTexto: 'WhatsApp',
  },
};

const mergeObject = (defaults, current) => {
  if (!current || typeof current !== 'object' || Array.isArray(current)) return copy(defaults);
  const result = { ...copy(defaults), ...current };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
      result[key] = mergeObject(defaultValue, current[key]);
    }
  }
  return result;
};

export function normalizeLandingContent(content) {
  const source = content && typeof content === 'object' && !Array.isArray(content) ? content : {};
  const normalized = mergeObject(DEFAULT_CMS_CONTENT, source);
  normalized.hero.slides = Array.isArray(source.hero?.slides) ? source.hero.slides : [];
  normalized.deportes = Array.isArray(source.deportes) ? source.deportes : [];
  normalized.docentes = Array.isArray(source.docentes) ? source.docentes : [];
  normalized.galeria.items = Array.isArray(source.galeria?.items) ? source.galeria.items : [];
  return normalized;
}

export function validateLandingContent(content) {
  const errors = [];
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { valid: false, errors: ['El contenido debe ser un objeto JSON.'] };
  }

  const limits = [
    ['hero.slides', content.hero?.slides, 20],
    ['deportes', content.deportes, 30],
    ['docentes', content.docentes, 50],
    ['galeria.items', content.galeria?.items, 80],
    ['navegacion.links', content.navegacion?.links, 20],
  ];
  for (const [name, value, max] of limits) {
    if (value !== undefined && !Array.isArray(value)) errors.push(`${name} debe ser una lista.`);
    if (Array.isArray(value) && value.length > max) errors.push(`${name} permite un máximo de ${max} elementos.`);
  }

  let stringCount = 0;
  const visit = (value, path = 'contenido') => {
    if (typeof value === 'string') {
      stringCount += 1;
      if (value.length > 12000) errors.push(`${path} supera el límite de 12000 caracteres.`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        errors.push(`${path}.${key} no está permitido.`);
        continue;
      }
      visit(value[key], `${path}.${key}`);
    }
  };
  visit(content);

  const bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
  if (bytes > 2 * 1024 * 1024) errors.push('El contenido completo supera el límite de 2 MB.');
  if (stringCount > 3000) errors.push('El contenido contiene demasiados campos de texto.');
  return { valid: errors.length === 0, errors };
}
