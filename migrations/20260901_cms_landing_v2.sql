-- CMS Landing v2 - migración idempotente y aislada del sistema operativo.
-- Solo crea o completa tablas landing_*; no modifica alumnos, pagos ni asistencias.

CREATE TABLE IF NOT EXISTS landing_texts (
  id INT NOT NULL AUTO_INCREMENT,
  section_slug VARCHAR(100) NOT NULL,
  item_index INT NOT NULL DEFAULT 0,
  clave VARCHAR(200) NOT NULL,
  valor TEXT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_landing_text (section_slug, item_index, clave),
  KEY idx_landing_text_section (section_slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS landing_images (
  id INT NOT NULL AUTO_INCREMENT,
  section_slug VARCHAR(100) NOT NULL,
  item_index INT NOT NULL DEFAULT 0,
  clave VARCHAR(200) NOT NULL DEFAULT 'image',
  url TEXT NOT NULL,
  alt_text VARCHAR(500) NOT NULL DEFAULT '',
  nombre_orig VARCHAR(500) NOT NULL DEFAULT '',
  subida_por VARCHAR(200) NOT NULL DEFAULT '',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_landing_image (section_slug, item_index, clave),
  KEY idx_landing_image_section (section_slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS landing_versions (
  id INT NOT NULL AUTO_INCREMENT,
  label VARCHAR(150) NOT NULL DEFAULT 'Borrador',
  notes TEXT NULL,
  status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
  content JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(120) NOT NULL DEFAULT 'admin',
  published_at TIMESTAMP NULL DEFAULT NULL,
  published_by VARCHAR(120) NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_status (status),
  KEY idx_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS landing_structure (
  id INT NOT NULL AUTO_INCREMENT,
  section_slug VARCHAR(100) NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  visible TINYINT(1) NOT NULL DEFAULT 1,
  config JSON NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_landing_structure_slug (section_slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS landing_media (
  id INT NOT NULL AUTO_INCREMENT,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  url TEXT NOT NULL,
  alt_text VARCHAR(500) NOT NULL DEFAULT '',
  created_by VARCHAR(120) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_landing_media_filename (filename),
  KEY idx_landing_media_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No insertar filas aquí: cada instalación puede conservar un orden público
-- distinto. La API aporta sus valores por defecto cuando la tabla está vacía.
