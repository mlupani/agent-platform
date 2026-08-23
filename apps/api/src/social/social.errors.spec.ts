import { mapZernioOAuthError } from './social.errors';

describe('mapZernioOAuthError', () => {
  it('explica no_facebook_pages', () => {
    const mapped = mapZernioOAuthError('no_facebook_pages');
    expect(mapped.platform).toBe('facebook');
    expect(mapped.message).toMatch(/Página/);
    expect(mapped.message).not.toMatch(/no_facebook_pages/);
  });

  it('no muestra códigos snake_case crudos', () => {
    expect(mapZernioOAuthError('some_unknown_code').message).toBe(
      'No se pudo completar la conexión. Volvé a intentar.',
    );
  });

  it('traduce access_denied', () => {
    expect(mapZernioOAuthError('access_denied').message).toMatch(/permiso/);
  });
});
