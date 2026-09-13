(() => {
  const ID = 'dsh-playbook'
  window.__ModuleLoader__.load({
    id: ID,
    factory(require) {
      const React = require('react')
      const h = React.createElement
      const css = `
.dpb{display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:16px;min-height:430px}.dpb *{box-sizing:border-box}
.dpb-side,.dpb-main{border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:12px;padding:14px}.dpb-head,.dpb-actions,.dpb-row{display:flex;align-items:center;gap:8px}.dpb-head{justify-content:space-between;margin-bottom:12px}.dpb-list{display:grid;gap:7px}.dpb-card{width:100%;text-align:left;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:9px;background:transparent;color:inherit;padding:10px;cursor:pointer}.dpb-card[data-on=true]{border-color:#4d6bfe;background:color-mix(in srgb,#4d6bfe 9%,transparent)}
.dpb-btn{border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:8px;background:transparent;color:inherit;padding:7px 10px;cursor:pointer}.dpb-btn[data-p=true]{background:#4d6bfe;border-color:#4d6bfe;color:white}.dpb-btn[data-d=true]{color:#e95d67}.dpb-btn:disabled{opacity:.45;cursor:not-allowed}.dpb-note{font-size:12px;opacity:.68;line-height:1.45}.dpb-badge{display:inline-flex;font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 18%,transparent)}.dpb-badge[data-k=ok]{color:#65c68a}.dpb-badge[data-k=warn]{color:#e7b35a}.dpb-badge[data-k=off]{opacity:.55}.dpb-sec{display:grid;gap:9px;margin:12px 0;padding:11px;border-radius:9px;background:color-mix(in srgb,currentColor 4%,transparent)}.dpb-sec>strong{font-size:13px}.dpb-pre{white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}.dpb-status{padding:9px;border-radius:8px;background:color-mix(in srgb,#4d6bfe 10%,transparent);margin:9px 0}.dpb-status[data-e=true]{color:#ff9aa2;background:color-mix(in srgb,#e95d67 12%,transparent)}.dpb-empty{text-align:center;padding:40px 16px;opacity:.65}.dpb-obs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.dpb-stat{padding:8px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 10%,transparent)}.dpb-stat span{display:block;font-size:11px;opacity:.62}.dpb-stat strong{font-size:15px}
@media(max-width:820px){.dpb{grid-template-columns:1fr}.dpb-obs{grid-template-columns:1fr 1fr}}`
      if (typeof document !== 'undefined' && !document.querySelector(`style[data-plugin-css="${ID}"]`)) {
        const style = document.createElement('style')
        style.dataset.pluginCss = ID
        style.textContent = css
        document.head.appendChild(style)
      }

      function Badge({ kind = 'off', children }) {
        return h('span', { className: 'dpb-badge', 'data-k': kind }, children)
      }

      async function runCommand(ctx, command) {
        const binding = ctx.uiSession.adapter.current.getSnapshot()
        const sessionId = binding?.props?.sessionId
        if (!sessionId) throw new Error('当前没有可用会话。请先打开一个会话。')
        const response = await ctx.remote.commands.execute(sessionId, command, [])
        if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
        if (response.value === undefined) throw new Error('Host 未返回命令结果，请确认 dsh-playbook 已在 Host 侧启用。')
        const result = response.value.result
        if (result?.kind !== 'success') throw new Error(result?.text ?? '命令执行失败。')
        return result.text ?? ''
      }

      async function loadJson(ctx, command) {
        const text = await runCommand(ctx, command)
        try { return JSON.parse(text) }
        catch { throw new Error(`Host 返回了无法解析的 JSON：${text.slice(0, 160)}`) }
      }

      function PlaybookPanel({ clientCtx }) {
        const [catalog, setCatalog] = React.useState([])
        const [status, setStatus] = React.useState(null)
        const [selected, setSelected] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [message, setMessage] = React.useState(null)

        const refresh = React.useCallback(async () => {
          setBusy(true); setMessage(null)
          try {
            const [nextCatalog, nextStatus] = await Promise.all([
              loadJson(clientCtx, '/playbook list'),
              loadJson(clientCtx, '/playbook status json'),
            ])
            setCatalog(Array.isArray(nextCatalog) ? nextCatalog : [])
            setStatus(nextStatus)
            if (!selected && nextCatalog?.[0]?.id) setSelected(nextCatalog[0].id)
          } catch (error) {
            setMessage({ error: true, text: String(error?.message ?? error) })
          } finally { setBusy(false) }
        }, [clientCtx, selected])

        React.useEffect(() => { void refresh() }, [])

        const start = async id => {
          setBusy(true); setMessage(null)
          try {
            await runCommand(clientCtx, `/playbook start ${id}`)
            setMessage({ error: false, text: `已启动 ${id}` })
            setStatus(await loadJson(clientCtx, '/playbook status json'))
          } catch (error) { setMessage({ error: true, text: String(error?.message ?? error) }) }
          finally { setBusy(false) }
        }

        const cancel = async () => {
          setBusy(true); setMessage(null)
          try {
            await runCommand(clientCtx, '/playbook cancel')
            setMessage({ error: false, text: '当前 Playbook 已取消。' })
            setStatus(await loadJson(clientCtx, '/playbook status json'))
          } catch (error) { setMessage({ error: true, text: String(error?.message ?? error) }) }
          finally { setBusy(false) }
        }

        const resume = async () => {
          setBusy(true); setMessage(null)
          try {
            await runCommand(clientCtx, '/playbook resume')
            setStatus(await loadJson(clientCtx, '/playbook status json'))
            setMessage({ error: false, text: '已恢复原阶段；请在聊天中让 Agent 继续。' })
          } catch (error) { setMessage({ error: true, text: String(error?.message ?? error) }) }
          finally { setBusy(false) }
        }

        const selectedPb = catalog.find(row => row.id === selected)
        const run = status?.run
        const stage = status?.stage
        const observations = Object.entries(status?.observations ?? {})
        return h('div', { className: 'dpb' }, [
          h('aside', { className: 'dpb-side', key: 'side' }, [
            h('div', { className: 'dpb-head', key: 'head' }, [
              h('div', { key: 'title' }, h('strong', null, 'Playbooks'), h('div', { className: 'dpb-note' }, `${catalog.length} 个流程`)),
              h('button', { className: 'dpb-btn', disabled: busy, onClick: refresh }, busy ? '刷新中…' : '刷新'),
            ]),
            h('div', { className: 'dpb-list', key: 'list' }, catalog.map(row => h('button', {
              className: 'dpb-card', 'data-on': selected === row.id, key: row.id, onClick: () => setSelected(row.id),
            }, [
              h('div', { className: 'dpb-row', key: 'r1' }, h('strong', null, row.name || row.id), h(Badge, { kind: row.source === 'builtin' ? 'ok' : 'off' }, row.source === 'builtin' ? '内置' : '自定义')),
              h('div', { className: 'dpb-note', key: 'r2' }, `${row.id} · v${row.version} · ${row.stages} stages`),
              row.description ? h('div', { className: 'dpb-note', key: 'r3' }, row.description) : null,
            ]))),
          ]),
          h('main', { className: 'dpb-main', key: 'main' }, [
            h('div', { className: 'dpb-head', key: 'head' }, [
              h('div', null, h('strong', null, '当前会话'), h('div', { className: 'dpb-note' }, run ? `${run.playbookId} · ${run.state}` : '尚未运行 Playbook')),
              h('div', { className: 'dpb-actions' }, [
                selectedPb && !(status?.attached ?? status?.active) ? h('button', { className: 'dpb-btn', 'data-p': true, disabled: busy, onClick: () => start(selectedPb.id) }, `启动 ${selectedPb.id}`) : null,
                status?.blocker ? h('button', { className: 'dpb-btn', disabled: busy, onClick: resume }, '恢复原阶段') : null,
                (status?.attached ?? status?.active) ? h('button', { className: 'dpb-btn', 'data-d': true, disabled: busy, onClick: cancel }, '取消运行') : null,
              ]),
            ]),
            status?.blocker ? h('div', { className: 'dpb-status', key: 'blocker' }, `等待处理：${status.blocker.reason}`) : null,
            message ? h('div', { className: 'dpb-status', 'data-e': message.error || undefined, key: 'msg' }, message.text) : null,
            !run ? h('div', { className: 'dpb-empty', key: 'empty' }, '从左侧选择一个 Playbook 启动。运行后这里会显示 Stage、Gate 和 Harness 实际观测到的工具事实。') : h(React.Fragment, { key: 'run' }, [
              h('section', { className: 'dpb-sec', key: 'runinfo' }, [
                h('strong', null, `${run.playbookId} / ${run.stageId}`),
                h('div', { className: 'dpb-row' }, [
                  h(Badge, { kind: run.state === 'active' ? 'ok' : run.state === 'completed' ? 'ok' : 'warn' }, run.state),
                  h(Badge, null, `attempt ${run.stageAttempt}`),
                ]),
                stage ? h('div', { className: 'dpb-note' }, `${stage.title} · ${stage.mode.toUpperCase()}`) : null,
                stage ? h('div', null, stage.objective) : null,
              ]),
              status.instruction ? h('section', { className: 'dpb-sec', key: 'instruction' }, h('strong', null, '当前执行契约'), h('pre', { className: 'dpb-pre' }, status.instruction)) : null,
              status.lastGate ? h('section', { className: 'dpb-sec', key: 'gate' }, [
                h('strong', null, '最近 Gate'),
                h('div', { className: 'dpb-row' }, h(Badge, { kind: status.lastGate.passed ? 'ok' : 'warn' }, status.lastGate.passed ? 'PASS' : 'REJECT'), h('span', { className: 'dpb-note' }, `attempt ${status.lastGate.attempt}`)),
                status.lastGate.failures?.length ? h('pre', { className: 'dpb-pre' }, status.lastGate.failures.map(x => `- ${x}`).join('\n')) : h('div', { className: 'dpb-note' }, 'Gate 已满足。'),
              ]) : null,
              h('section', { className: 'dpb-sec', key: 'obs' }, [
                h('strong', null, 'Harness 工具观测'),
                observations.length ? h('div', { className: 'dpb-obs' }, observations.flatMap(([name, row]) => [
                  h('div', { className: 'dpb-stat', key: `${name}-calls` }, h('span', null, `${name} calls`), h('strong', null, String(row.calls))),
                  h('div', { className: 'dpb-stat', key: `${name}-ok` }, h('span', null, 'success'), h('strong', null, String(row.successes))),
                  h('div', { className: 'dpb-stat', key: `${name}-fail` }, h('span', null, 'failure'), h('strong', null, String(row.failures))),
                ])) : h('div', { className: 'dpb-note' }, '当前 Stage 尚未记录到工具调用。'),
              ]),
            ]),
          ]),
        ])
      }

      const inject = ['slots', 'uiSession', 'remote', 'remote.commands']
      function apply(ctx) {
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'playbook',
          order: 30,
          label: 'Playbook',
          inject: () => ({ clientCtx: ctx }),
        }, PlaybookPanel))
      }
      return { inject, apply }
    },
  })
})()
