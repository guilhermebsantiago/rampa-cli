// .storybook/test-runner.ts: Rampa in the Storybook test-runner (docs/storybook.md).
//
// After each story renders, Rampa checks the story root: axe-core, then the judgment layer
// when RAMPA_MODEL names a model. The story's test fails with each finding listed.
import { type TestRunnerConfig, getStoryContext, waitForPageReady } from '@storybook/test-runner'
import { type CheckPageOptions, assertRampa, checkPage } from 'rampa/playwright'

const config: TestRunnerConfig = {
  async postVisit(page, context) {
    // Per story: parameters: { rampa: { disable: true } }, or any checkPage option, such as { rampa: { criteria: ['1.1.1'] } }.
    const story = await getStoryContext(page, context)
    const { disable, ...options } = (story.parameters?.rampa ?? {}) as CheckPageOptions & { disable?: boolean }
    if (disable) return

    // Fonts and images settle first, so the check sees the story as people do.
    await waitForPageReady(page)
    const report = await checkPage(page, {
      // Only the story: Storybook's own page around it is not the component's.
      include: '#storybook-root',
      // Without RAMPA_MODEL only axe-core runs, and the report says the judgment was off.
      noLlm: !process.env.RAMPA_MODEL,
      ...options,
    })
    assertRampa(report)
  },
}

export default config
