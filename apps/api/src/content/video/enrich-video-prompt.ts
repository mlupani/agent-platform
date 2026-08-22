const PHYSICAL_INTERACTION_RE =
  /\b(hands?|fingers?|palm|wrist|grip|grasp(?:ing|es)?|holding|holds?|held|spoon|fork|knife|spatula|whisk(?:ing)?|tongs|ladle|chopsticks?|utensils?|brush(?:es|ing)?|comb|scissors|tweezers|razor|glass(?:es)?|cups?|mugs?|bottles?|plates?|bowls?|pans?|pots?|skillet|stir(?:ring|s)?|pour(?:ing|s)?|chop(?:ping|s)?|slic(?:e|ing|es)|mix(?:ing|es)?|plating|flip(?:ping|s)?|spread(?:ing|s)?|applying|pipette|syringe|mano|manos|dedos?|cuchara|tenedor|cuchillo|utensilio)\b/i;

export function hasPhysicalObjectInteraction(prompt: string): boolean {
  return PHYSICAL_INTERACTION_RE.test(prompt);
}

export function enrichMarketingVideoPrompt(input: {
  basePrompt: string;
  durationSeconds: number;
}): string {
  const base = input.basePrompt.trim();
  const motion = [
    'MOTION (mandatory):',
    'one clear primary action',
    'one smooth continuous action',
    'slow, controlled movement',
    'Keep one simple camera: locked-off or a single gentle move.',
    'Prioritize one continuous action for the whole shot. Do not stack walking, complex hand work, extra props, and camera motion together.',
  ];

  const physical = hasPhysicalObjectInteraction(base)
    ? [
        '',
        'PHYSICAL INTERACTION (hands / tools / objects in this scene):',
        'Describe the single object being handled, which hand holds it, and how it is held.',
        'natural hand movement',
        'stable realistic grip',
        'realistic physical interaction',
        'consistent object shape and size',
        'One smooth and controlled continuous movement. The hand maintains a stable, natural grip. The object remains consistent in shape and size throughout the action.',
      ]
    : [];

  return [
    base,
    '',
    'VERTICAL SHORT (mandatory):',
    `9:16 social short (${input.durationSeconds} seconds), cinematic marketing shot, not a raw home video.`,
    'Professional lighting, high contrast.',
    'Do NOT render any on-screen text, captions, logos, watermarks, headlines or typography. Pure visuals only — text overlays are added later.',
    '',
    ...motion,
    ...physical,
  ].join('\n');
}
