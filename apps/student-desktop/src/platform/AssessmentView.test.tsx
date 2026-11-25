// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssessmentView } from './AssessmentView';

const mocks = vi.hoisted(() => ({
  packsList: vi.fn(),
  installPackFromBroker: vi.fn(),
  assessmentStatus: vi.fn(),
  assessmentStoreKey: vi.fn(),
  packsListQuestions: vi.fn(),
  packsGetQuestion: vi.fn(),
  callBroker: vi.fn(),
  deviceInfo: vi.fn(),
  attemptsList: vi.fn(),
  getCursor: vi.fn(),
  setCursor: vi.fn(),
  runtimesList: vi.fn(),
  supabaseRows: [] as unknown[],
}));

vi.mock('../lib/packs', () => ({
  packsList: mocks.packsList,
  installPackFromBroker: mocks.installPackFromBroker,
  assessmentStatus: mocks.assessmentStatus,
  assessmentStoreKey: mocks.assessmentStoreKey,
  packsListQuestions: mocks.packsListQuestions,
  packsGetQuestion: mocks.packsGetQuestion,
}));
vi.mock('../lib/broker', () => ({ callBroker: mocks.callBroker }));
vi.mock('../lib/offline-store', () => ({
  deviceInfo: mocks.deviceInfo,
  attemptsList: mocks.attemptsList,
  getCursor: mocks.getCursor,
  setCursor: mocks.setCursor,
}));
vi.mock('../lib/runtimes', () => ({ runtimesList: mocks.runtimesList }));
vi.mock('./OfflineQuestionWorkspace', () => ({ OfflineQuestionWorkspace: () => <div>Workspace</div> }));
vi.mock('../lib/supabase-client', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        neq: () => ({
          order: async () => ({ data: mocks.supabaseRows, error: null }),
        }),
      }),
    }),
  }),
}));

const assessmentRow = {
  id: 'a1',
  title: 'Midterm Exam',
  opens_at: '2026-11-25T09:00:00.000Z',
  closes_at: '2026-11-25T12:00:00.000Z',
  duration_minutes: 60,
  attempts_allowed: 3,
  high_stakes: true,
  status: 'SCHEDULED',
  course_pack_versions: [{ pack_id: 'a1@1', version: 1 }],
};

const installedPack = {
  packId: 'a1@1',
  kind: 'ASSESSMENT' as const,
  courseId: '',
  assessmentId: 'a1',
  version: 1,
  title: 'Midterm Exam',
  languages: ['PYTHON'],
  questionCount: 1,
  installedAt: '2026-11-25T08:00:00.000Z',
};

describe('AssessmentView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    mocks.supabaseRows = [assessmentRow];
    mocks.packsList.mockResolvedValue([]);
    mocks.getCursor.mockResolvedValue(null);
    mocks.setCursor.mockResolvedValue(undefined);
    mocks.assessmentStatus.mockResolvedValue({ hasKey: false, startedAtMs: null, endsAtMs: null });
    mocks.deviceInfo.mockResolvedValue({ deviceId: 'dev-1', publicKey: 'pk', monotonicSeq: 1 });
    mocks.runtimesList.mockResolvedValue([{ language: 'PYTHON', version: '3.12', path: '/py', installedAt: 'x' }]);
    mocks.attemptsList.mockResolvedValue([]);
    mocks.packsListQuestions.mockResolvedValue([
      { id: 'q1', title: 'Sum', topics: ['math'], difficulty: 'EASY', points: 10, order: 1 },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('lists assessments and downloads a pack via the broker', async () => {
    mocks.installPackFromBroker.mockResolvedValue(installedPack);
    render(<AssessmentView />);
    expect(await screen.findByText('Midterm Exam')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(mocks.installPackFromBroker).toHaveBeenCalledWith('a1@1'));
  });

  it('shows the offline Start message when disconnected', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    mocks.packsList.mockResolvedValue([installedPack]);
    mocks.getCursor.mockResolvedValue(
      JSON.stringify([
        {
          id: 'a1',
          title: 'Midterm Exam',
          opensAt: assessmentRow.opens_at,
          closesAt: assessmentRow.closes_at,
          durationMinutes: 60,
          attemptsAllowed: 3,
          highStakes: true,
          status: 'SCHEDULED',
          latestPackId: 'a1@1',
          latestVersion: 1,
        },
      ]),
    );
    render(<AssessmentView />);
    const startBtn = await screen.findByRole('button', { name: 'Start' });
    fireEvent.click(startBtn);
    expect((await screen.findByRole('alert')).textContent).toContain('Connect once at the start time to unlock');
    expect(mocks.callBroker).not.toHaveBeenCalled();
  });

  it('fetches the key online, stores it, and shows timer and attempts left', async () => {
    mocks.packsList.mockResolvedValue([installedPack]);
    mocks.callBroker.mockResolvedValue({ keyId: 'k1', keyB64: 'A'.repeat(44), closesAt: assessmentRow.closes_at });
    mocks.assessmentStoreKey.mockResolvedValue(undefined);
    mocks.assessmentStatus
      .mockResolvedValueOnce({ hasKey: false, startedAtMs: null, endsAtMs: null })
      .mockResolvedValueOnce({ hasKey: true, startedAtMs: Date.now(), endsAtMs: Date.now() + 3600_000 });
    mocks.attemptsList.mockResolvedValue([
      {
        attemptId: 'att-1',
        packId: 'a1@1',
        questionId: 'q1',
        assessmentId: 'a1',
        language: 'PYTHON',
        mode: 'SUBMIT',
      },
    ]);

    render(<AssessmentView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(mocks.callBroker).toHaveBeenCalledWith('assessment-key', { assessmentId: 'a1', deviceId: 'dev-1' });
      expect(mocks.assessmentStoreKey).toHaveBeenCalledWith('a1', 'k1', 'A'.repeat(44));
    });
    expect((await screen.findByRole('timer')).textContent).toContain('Time remaining:');
    expect(await screen.findByText('Attempts left: 2')).toBeTruthy();
  });
});
