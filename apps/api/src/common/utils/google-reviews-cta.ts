const GOOGLE_REVIEWS_CTA =
  'Si te gustó la atención, nos ayudás mucho dejando una reseña acá:';

export function appendGoogleReviewsCta(
  body: string,
  url: string | null | undefined,
): string {
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) return body;
  if (body.includes(trimmedUrl)) return body;
  if (/cancel/i.test(body)) return body;
  return `${body.trimEnd()}\n\n${GOOGLE_REVIEWS_CTA}\n${trimmedUrl}`;
}
