import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { COURSE_ID, QUESTION_ID } from './test/mock-data';
import { renderApp, Root } from './test/harness';

const editorHash = `#/teacher/courses/${COURSE_ID}/questions/${QUESTION_ID}`;

describe('teacher hidden-test editor', () => {
  it('round-trips a hidden test through save and reload', async () => {
    const user = userEvent.setup();
    const view = await renderApp({ email: 'TEACHER', hash: editorHash });
    expect((await screen.findAllByRole('heading', { name: 'Two Sum' })).length).toBeGreaterThan(0);

    const inputs = screen.getAllByLabelText('Input') as HTMLTextAreaElement[];
    const hiddenInput = inputs[1];
    expect(inputs).toHaveLength(2);
    if (!hiddenInput) throw new Error('hidden test input missing');
    expect(hiddenInput.value).toBe('10 20');

    await user.clear(hiddenInput);
    await user.type(hiddenInput, '21 21');
    await user.click(screen.getByRole('button', { name: 'Save question' }));
    expect(await screen.findByText('Question saved.')).toBeTruthy();

    view.unmount();
    render(<Root runtime={view.runtime} />);
    const reloaded = (await screen.findAllByLabelText('Input')) as HTMLTextAreaElement[];
    expect(reloaded[1]?.value).toBe('21 21');
  });

  it('refuses to save with no visible tests', async () => {
    const user = userEvent.setup();
    await renderApp({ email: 'TEACHER', hash: editorHash });
    await screen.findAllByRole('heading', { name: 'Two Sum' });
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Save question' }));
    expect(await screen.findByText('At least one visible test is required')).toBeTruthy();
  });
});
