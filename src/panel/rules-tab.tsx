// rules-tab.tsx: the Rules tab: your own rules for the rewriter, and prompt structures.
import { Badge, Box, Button, Checkbox, IconButton, Input, read, Row, Select, set, Stack, Text, Textarea } from 'orca'
import { t } from '../i18n.ts'
import { allStructures, BUILT_IN_STRUCTURES, MAX_RULES, MAX_STRUCTURES } from '../rules.ts'
import { Hint, Section } from './common.tsx'
import { ruleDraft, ruleScope, structureDraft, workspaceName } from './state.ts'
import { rulesConfig } from './view.ts'
import { refreshRules, saveRules, addRule, addStructure, removeStructure } from './actions.ts'
export { rulesConfig, refreshRules }

export function RulesTab() {
  const config = rulesConfig()
  const workspace = read(workspaceName)
  const draft = read(structureDraft)
  return (
    <Stack gap="md">
      <Section
        title={t('Your rules')}
        hint={t('Followed in every enhanced prompt and by auto-enhance, on top of the style. A rule can apply to every workspace or only to this one.')}
      >
        {config.rules.length === 0 ? <Text muted size="sm">{t('No rules yet. Example: "Always tell the agent to run pnpm test before finishing."')}</Text> : null}
        <Stack gap="xs">
          {config.rules.map((rule) => (
            <Row key={rule.id} gap="xs" justify="between">
              <Checkbox
                label={rule.text}
                checked={rule.enabled}
                onChange={(enabled) => saveRules((current) => ({ ...current, rules: current.rules.map((entry) => (entry.id === rule.id ? { ...entry, enabled } : entry)) }))}
              />
              <Row gap="xs">
                <Badge tone={rule.scope ? 'accent' : 'neutral'}>{rule.scope || t('everywhere')}</Badge>
                <IconButton
                  icon="delete"
                  label={t('Delete')}
                  size="sm"
                  variant="ghost"
                  onPress={() => saveRules((current) => ({ ...current, rules: current.rules.filter((entry) => entry.id !== rule.id) }))}
                />
              </Row>
            </Row>
          ))}
        </Stack>
        <Textarea label={t('New rule')} rows={2} placeholder={t('e.g. Answer in Vietnamese; keep code identifiers in English.')} value={read(ruleDraft)} onChange={(value) => set(ruleDraft, value)} onSubmit={addRule} />
        <Row gap="xs" wrap>
          <Select
            label={t('Applies to')}
            labelHidden
            value={read(ruleScope)}
            options={[
              { value: 'all', label: t('All workspaces') },
              ...(workspace ? [{ value: 'workspace', label: t('Only {name}', { name: workspace }) }] : [])
            ]}
            onChange={(value) => set(ruleScope, value)}
          />
          <Button icon="add" variant="outline" onPress={addRule} disabled={!read(ruleDraft).trim() || config.rules.length >= MAX_RULES}>
            {t('Add rule')}
          </Button>
        </Row>
      </Section>
      <Section
        title={t('Prompt structures')}
        hint={t('Pick one under Options in the composer: the prompt is written under these headings instead of the style\'s shape.')}
      >
        <Stack gap="xs">
          {allStructures(config).map(({ structure, edited }) => {
            // An edited built-in shows as saved (your words, untranslated) and can be deleted to restore it.
            const builtIn = BUILT_IN_STRUCTURES.includes(structure) && !edited
            return (
              <Box key={structure.id} gap="none" padding="sm" border radius="md">
                <Row justify="between" gap="xs">
                  <Text weight="medium">{builtIn ? t(structure.name) : structure.name}</Text>
                  {builtIn ? (
                    <Badge tone="neutral">{t('built-in')}</Badge>
                  ) : (
                    <IconButton icon="delete" label={t('Delete')} size="sm" variant="ghost" onPress={() => removeStructure(structure.id)} />
                  )}
                </Row>
                <Text muted size="xs">
                  {structure.sections.map((section) => (builtIn ? t(section) : section)).join(' · ')}
                </Text>
              </Box>
            )
          })}
        </Stack>
        <Input label={t('Structure name')} placeholder={t('e.g. My brief')} value={draft.name} onChange={(value) => set(structureDraft, { ...draft, name: value })} />
        <Row gap="xs">
          <Text muted size="xs">
            {t('Headings, one per line')}
          </Text>
          <Hint text={t('Written in any language; the rewriter translates them into the output language.')} />
        </Row>
        <Textarea
          label={t('Headings, one per line')}
          labelHidden
          rows={4}
          placeholder={'Mục tiêu\nBối cảnh\nYêu cầu\nTiêu chí hoàn thành'}
          value={draft.sections}
          onChange={(value) => set(structureDraft, { ...draft, sections: value })}
        />
        <Row>
          <Button icon="add" variant="outline" onPress={() => addStructure()} disabled={!draft.name.trim() || !draft.sections.trim() || config.structures.length >= MAX_STRUCTURES}>
            {t('Add structure')}
          </Button>
        </Row>
      </Section>
    </Stack>
  )
}
