import { appendGoogleReviewsCta } from './google-reviews-cta';

describe('appendGoogleReviewsCta', () => {
  const url = 'https://g.page/r/demo/review';

  it('returns the body unchanged when there is no url', () => {
    expect(appendGoogleReviewsCta('Turno confirmado.', null)).toBe(
      'Turno confirmado.',
    );
    expect(appendGoogleReviewsCta('Turno confirmado.', '  ')).toBe(
      'Turno confirmado.',
    );
  });

  it('appends the review CTA when the url is missing from the body', () => {
    expect(appendGoogleReviewsCta('Turno confirmado.', url)).toBe(
      'Turno confirmado.\n\nSi te gustó la atención, nos ayudás mucho dejando una reseña acá:\nhttps://g.page/r/demo/review',
    );
  });

  it('does not duplicate the url if the agent already included it', () => {
    const body = `Turno confirmado.\n${url}`;
    expect(appendGoogleReviewsCta(body, url)).toBe(body);
  });

  it('does not append the CTA on cancellation messages', () => {
    expect(appendGoogleReviewsCta('Tu cita fue cancelada.', url)).toBe(
      'Tu cita fue cancelada.',
    );
  });
});
