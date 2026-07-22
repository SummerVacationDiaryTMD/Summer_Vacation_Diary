// Prompt for the "sketch" action (photo → child-style colored-pencil
// drawing via OpenAI images/edits). Content-only module: a single exported
// string, no imports, no logic. Everything between the backticks is sent
// to the model verbatim.
export const SKETCH_PROMPT = `Redraw the input photo as an authentic colored-pencil drawing made by a 6–8-year-old child.
Use shaky uneven pencil lines, awkward proportions, flattened perspective, rough dry scribbles, visible paper grain, white gaps, and colors crossing outlines.
Keep the scene recognizable, warm, sincere, naive, asymmetrical, and visibly handmade.
Avoid photorealism, professional illustration, anime, manga, chibi, kawaii, clean line art, smooth gradients, digital painting, perfect anatomy, text, logos, watermarks, borders, and UI elements.`;
