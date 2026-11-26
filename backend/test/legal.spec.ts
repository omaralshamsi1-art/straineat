import { describe, expect, it } from 'vitest';
import { renderLegal } from '../src/legal/legal';

const o = { name: 'Test Person', email: 'a@b.co', geminiTier: 'free' as const, base: 'https://x.example' };
describe('legal pages', () => {
  it('render both languages with the publisher, contact and AI provider', () => {
    for (const page of ['privacy', 'terms', 'support'] as const) {
      for (const lang of ['ar', 'en'] as const) {
        const h = renderLegal(page, lang, o);
        expect(h).toContain(lang === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
        expect(h).toContain('a@b.co');
      }
    }
    expect(renderLegal('privacy', 'en', o)).toContain('Test Person');
    expect(renderLegal('privacy', 'en', o)).toContain('Gemini');
    expect(renderLegal('privacy', 'en', o)).toMatch(/free tier/);
    expect(renderLegal('privacy', 'en', { ...o, geminiTier: 'paid' })).toMatch(/not used to train/);
    expect(renderLegal('terms', 'ar', o)).toContain('ليس جهازاً طبياً');
  });
  it('escapes the configured name', () => {
    expect(renderLegal('privacy', 'en', { ...o, name: '<script>x' })).not.toContain('<script>x');
  });
});
