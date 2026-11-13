import { describe, it, expect, vi } from 'vitest';
import { cn } from '@/lib/utils';
import { DOC_FOLDERS, base64ToBlob, blobToBase64, textToBase64 } from '@/lib/docs';

vi.mock('@/lib/api', () => ({
  activeDocs: { list: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));

describe('cn', () => {
  it('unisce le classi e risolve i conflitti Tailwind (l\'ultima vince)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-sm', 'font-bold')).toBe('text-sm font-bold');
  });

  it('ignora valori falsy e supporta la forma a oggetto', () => {
    const includeB: boolean = false;
    expect(cn('a', includeB && 'b', undefined, null, 'c')).toBe('a c');
    expect(cn({ a: true, b: false })).toBe('a');
  });
});

describe('docs - conversione base64', () => {
  it('codifica testo UTF-8 in base64', () => {
    expect(textToBase64('Ciao')).toBe('Q2lhbw==');
  });

  it('ricostruisce un Blob da base64 mantenendo contenuto e mime type', async () => {
    const blob = base64ToBlob('Q2lhbw==', 'text/plain');
    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('Ciao');
  });

  it('usa un mime type di fallback quando assente', () => {
    expect(base64ToBlob('Q2lhbw==', '').type).toBe('application/octet-stream');
  });

  it('esegue un round-trip blob -> base64 -> blob preservando i caratteri accentati', async () => {
    const original = new Blob(['Città è già'], { type: 'text/plain' });
    const base64 = await blobToBase64(original);
    expect(await base64ToBlob(base64, 'text/plain').text()).toBe('Città è già');
  });
});

describe('docs - cartelle convenzionali', () => {
  it('include le cartelle usate dall\'app', () => {
    expect(Object.values(DOC_FOLDERS)).toEqual(
      expect.arrayContaining(['registri', 'firma', 'semilavorati', 'ingresso', 'documenti'])
    );
  });
});
