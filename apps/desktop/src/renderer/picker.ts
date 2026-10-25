import type { PickerSource } from '../shared/types';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const api = window.nebulaPicker!;
if (!api) {
  document.body.innerHTML =
    '<main style="padding:40px;color:#ff8199;font-family:system-ui">共享选择窗口未正确加载预加载脚本。</main>';
  throw new Error('nebulaPicker preload API is missing');
}

let sources: PickerSource[] = [];
let tab: 'screen' | 'window' = 'screen';
let selectedId: string | null = null;
let loading = false;
let submitting = false;

const grid = byId<HTMLDivElement>('source-grid');
const empty = byId<HTMLDivElement>('source-empty');
const loadingIndicator = byId<HTMLDivElement>('source-loading');
const errorBox = byId<HTMLParagraphElement>('picker-error');
const screenCount = byId<HTMLSpanElement>('screen-count');
const windowCount = byId<HTMLSpanElement>('window-count');
const audioInput = byId<HTMLInputElement>('share-audio');
const audioHint = byId<HTMLParagraphElement>('audio-hint');
const shareButton = byId<HTMLButtonElement>('confirm-picker');
const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-tab]'),
);

function currentSources(): PickerSource[] {
  return sources.filter((source) =>
    tab === 'screen' ? source.isScreen : !source.isScreen,
  );
}

function selectedSource(): PickerSource | undefined {
  return sources.find((source) => source.id === selectedId);
}

function setError(message: string): void {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function updateTabCounts(): void {
  screenCount.textContent = `(${sources.filter((source) => source.isScreen).length})`;
  windowCount.textContent = `(${sources.filter((source) => !source.isScreen).length})`;
}

function updateAudioHint(): void {
  const selected = selectedSource();
  const supported = Boolean(selected?.supportsAudio);
  audioInput.disabled = !supported;
  if (!selected) {
    audioHint.textContent = '选择一个共享源后可以设置系统音频。';
  } else if (!supported) {
    audioHint.textContent = '系统音频仅支持共享整个屏幕（Windows loopback）。';
  } else {
    audioHint.textContent = 'Windows 系统声音会随屏幕一起发送。';
  }
}

function render(): void {
  updateTabCounts();
  for (const button of tabButtons) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }

  const visible = currentSources();
  if (visible.length === 0) {
    grid.replaceChildren();
    empty.hidden = false;
    selectedId = null;
  } else {
    empty.hidden = true;
    if (!visible.some((source) => source.id === selectedId)) {
      selectedId = visible[0].id;
    }
    grid.replaceChildren(
      ...visible.map((source) => createSourceCard(source)),
    );
  }

  updateAudioHint();
  shareButton.disabled = !selectedId || submitting;
  shareButton.textContent = submitting ? '正在启动…' : '开始共享';
}

function createSourceCard(source: PickerSource): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'source-card';
  card.classList.toggle('selected', source.id === selectedId);
  card.setAttribute('role', 'option');
  card.setAttribute('aria-selected', String(source.id === selectedId));
  card.title = source.name;

  const thumb = document.createElement('span');
  thumb.className = 'source-thumb';
  if (source.thumbnail) {
    const image = document.createElement('img');
    image.src = source.thumbnail;
    image.alt = '';
    image.draggable = false;
    thumb.append(image);
  } else {
    const icon = document.createElement('span');
    icon.textContent = source.isScreen ? '▣' : '▢';
    icon.style.fontSize = '28px';
    icon.style.opacity = '0.5';
    thumb.append(icon);
  }

  const check = document.createElement('span');
  check.className = 'source-check';
  check.textContent = '✓';

  const name = document.createElement('span');
  name.className = 'source-name';
  const label = document.createElement('span');
  label.textContent = source.name;
  name.append(label);

  card.append(thumb, check, name);
  card.addEventListener('click', () => {
    selectedId = source.id;
    render();
  });
  card.addEventListener('dblclick', () => {
    selectedId = source.id;
    void submit();
  });
  return card;
}

async function loadSources(): Promise<void> {
  if (loading) return;
  loading = true;
  setError('');
  empty.hidden = true;
  loadingIndicator.hidden = false;
  grid.replaceChildren();
  try {
    sources = await api.getSources();
    const hasScreen = sources.some((source) => source.isScreen);
    if (tab === 'screen' && !hasScreen && sources.length > 0) {
      tab = 'window';
    }
    render();
  } catch (error) {
    setError(error instanceof Error ? error.message : '读取共享源失败');
    empty.hidden = false;
  } finally {
    loading = false;
    loadingIndicator.hidden = true;
  }
}

async function submit(): Promise<void> {
  if (submitting) return;
  if (!selectedId) return;
  submitting = true;
  setError('');
  render();
  try {
    const selected = selectedSource();
    const withAudio = Boolean(
      selected?.supportsAudio && audioInput.checked,
    );
    const result = await api.select(selectedId, withAudio);
    if (!result.ok) {
      setError(result.error ?? '无法开始共享');
      submitting = false;
      render();
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : '无法开始共享');
    submitting = false;
    render();
  }
}

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    const next = button.dataset.tab === 'window' ? 'window' : 'screen';
    if (tab === next) return;
    tab = next;
    selectedId = null;
    render();
  });
}

audioInput.addEventListener('change', updateAudioHint);
byId<HTMLButtonElement>('refresh-sources').addEventListener('click', () => {
  void loadSources();
});
byId<HTMLButtonElement>('cancel-picker').addEventListener('click', () =>
  api.cancel(),
);
byId<HTMLButtonElement>('picker-close').addEventListener('click', () =>
  api.cancel(),
);
shareButton.addEventListener('click', () => void submit());

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    api.cancel();
  } else if (event.key === 'Enter' && document.activeElement?.tagName !== 'INPUT') {
    event.preventDefault();
    void submit();
  }
});

void loadSources();
