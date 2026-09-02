import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CMS_CONTENT, normalizeLandingContent, validateLandingContent } from '../utils/landing-content.js';
import { verificarAdmin } from '../middleware/auth.js';

test('normaliza contenido legado sin perder campos existentes', () => {
  const legacy = { hero: { slides: [{ id: 7, title: 'Portada' }] }, pagos: { plin: { numero: '999' } } };
  const normalized = normalizeLandingContent(legacy);
  assert.equal(normalized.hero.slides[0].title, 'Portada');
  assert.equal(normalized.pagos.plin.numero, '999');
  assert.equal(normalized.navegacion.nombreClub, DEFAULT_CMS_CONTENT.navegacion.nombreClub);
  assert.ok(Array.isArray(normalized.navegacion.links));
});

test('devuelve copias independientes de los valores por defecto', () => {
  const first = normalizeLandingContent({});
  first.navegacion.links[0].label = 'Modificado';
  const second = normalizeLandingContent({});
  assert.notEqual(second.navegacion.links[0].label, 'Modificado');
});

test('acepta un contenido CMS válido', () => {
  const result = validateLandingContent(normalizeLandingContent({}));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('rechaza listas excesivas y textos demasiado largos', () => {
  const invalid = normalizeLandingContent({
    hero: { slides: Array.from({ length: 21 }, (_, id) => ({ id })) },
    general: { copyright: 'x'.repeat(12001) },
  });
  const result = validateLandingContent(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('máximo de 20')));
  assert.ok(result.errors.some(error => error.includes('12000 caracteres')));
});

test('autoriza admin y super_admin, pero rechaza profesor', () => {
  const run = role => {
    let nextCalled = false;
    let statusCode = 200;
    let body;
    const req = { user: { rol: role } };
    const res = {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; return this; },
    };
    verificarAdmin(req, res, () => { nextCalled = true; });
    return { nextCalled, statusCode, body };
  };

  assert.equal(run('admin').nextCalled, true);
  assert.equal(run('super_admin').nextCalled, true);
  const profesor = run('profesor');
  assert.equal(profesor.nextCalled, false);
  assert.equal(profesor.statusCode, 403);
  assert.equal(profesor.body.error, 'Acceso denegado');
});
