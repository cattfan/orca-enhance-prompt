// history-tab.tsx: part of the Enhance Prompt panel (entry: src/panel.tsx).
import { Box, Button, EmptyState, IconButton, Input, read, RelativeTime, Row, set, Stack, Text, update } from 'orca'
import { isStyle, STYLE_LABELS } from '../prompts.ts'
import { t } from '../i18n.ts'
import { historyFilter, HISTORY_PAGE, historyShown, confirmClearHistory, history, filteredHistory } from './state.ts'
import { copy, reuse, removeEntry, clearHistory } from './actions.ts'

export function HistoryTab() {
  const all = read(history)
  const list = read(filteredHistory)
  const shown = read(historyShown)
  if (all.length === 0) {
    return <EmptyState icon="book" title={t('No history yet')} description={t('Enhanced prompts show up here.')} />
  }
  return (
    <Stack gap="sm">
      <Input label={t('Search history')} labelHidden type="search" placeholder={t('Search history')} value={read(historyFilter)} onChange={(value) => set(historyFilter, value)} />
      <Stack gap="xs">
        {list.slice(0, shown).map((entry) => (
          <Box key={entry.id} gap="xs" padding="sm" border radius="md">
            <Text weight="medium" truncate>
              {entry.original.split('\n')[0].slice(0, 160)}
            </Text>
            <Row gap="xs" justify="between">
              <Text muted size="xs">
                {t(STYLE_LABELS[isStyle(entry.style) ? entry.style : 'balanced'])} · {entry.model}
                {entry.source === 'hook' ? ` · ${t('auto')}` : ''} · <RelativeTime at={entry.at} />
              </Text>
              <Row gap="xs">
                <IconButton icon="edit" label={t('Open in Enhance tab')} size="sm" variant="ghost" onPress={() => reuse(entry)} />
                <IconButton icon="copy" label={t('Copy enhanced prompt')} size="sm" variant="ghost" onPress={() => void copy(entry.enhanced)} />
                <IconButton icon="delete" label={t('Delete')} size="sm" variant="ghost" onPress={() => void removeEntry(entry.id)} />
              </Row>
            </Row>
          </Box>
        ))}
      </Stack>
      {list.length > shown ? (
        <Button variant="ghost" size="sm" onPress={() => update(historyShown, (count) => count + HISTORY_PAGE)}>
          {t('Show more')}
        </Button>
      ) : null}
      <Row justify="between">
        <Text muted size="xs">
          {t('{shown} of {total}', { shown: Math.min(shown, list.length), total: all.length })}
        </Text>
        <Button
          variant={read(confirmClearHistory) ? 'solid' : 'ghost'}
          tone="danger"
          size="sm"
          icon="delete"
          onPress={() => (read(confirmClearHistory) ? void clearHistory() : set(confirmClearHistory, true))}
        >
          {read(confirmClearHistory) ? t('Press again to clear history') : t('Clear history')}
        </Button>
      </Row>
    </Stack>
  )
}
