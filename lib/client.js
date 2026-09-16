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

      async function runCommand(ctx, command, expectedSessionId) {
        const binding = ctx.uiSession.adapter.current.getSnapshot()
        const sessionId = binding?.props?.sessionId
        if (!sessionId) throw new Error('当前没有可用会话。请先打开一个会话。')
        if (expectedSessionId && expectedSessionId !== sessionId) throw new Error('当前会话已经改变，请刷新并查看当前候选或项目 SOP 后再操作。')
        const response = await ctx.remote.commands.execute(sessionId, command, [])
        if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
        if (response.value === undefined) throw new Error('Host 未返回命令结果，请确认 dsh-playbook 已在 Host 侧启用。')
        const result = response.value.result
        if (result?.kind !== 'success') throw new Error(result?.text ?? '命令执行失败。')
        return result.text ?? ''
      }

      async function loadJson(ctx, command, expectedSessionId) {
        const text = await runCommand(ctx, command, expectedSessionId)
        try { return JSON.parse(text) }
        catch { throw new Error(`Host 返回了无法解析的 JSON：${text.slice(0, 160)}`) }
      }

      function PlaybookPanel({ clientCtx }) {
        const [catalog, setCatalog] = React.useState([])
        const [projectSops, setProjectSops] = React.useState([])
        const [inspectedSop, setInspectedSop] = React.useState(null)
        const [status, setStatus] = React.useState(null)
        const [selected, setSelected] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [message, setMessage] = React.useState(null)

        const [reviewNote, setReviewNote] = React.useState('')
        const loadSequence = React.useRef(0)
        const reviewBusy = React.useRef(false)
        const sessionIdNow = () => clientCtx.uiSession.adapter.current.getSnapshot()?.props?.sessionId

        const refresh = React.useCallback(async (quiet = false) => {
          const expectedSessionId = clientCtx.uiSession.adapter.current.getSnapshot()?.props?.sessionId
          const sequence = ++loadSequence.current
          if (!quiet) { setBusy(true); setMessage(null) }
          try {
            const [nextCatalog, nextStatus, nextSops] = await Promise.all([
              loadJson(clientCtx, '/playbook list', expectedSessionId),
              loadJson(clientCtx, '/playbook status json', expectedSessionId),
              loadJson(clientCtx, '/playbook sops', expectedSessionId),
            ])
            if (sequence !== loadSequence.current || expectedSessionId !== clientCtx.uiSession.adapter.current.getSnapshot()?.props?.sessionId) return
            setCatalog(Array.isArray(nextCatalog) ? nextCatalog : [])
            setStatus(nextStatus)
            setProjectSops(Array.isArray(nextSops) ? nextSops : [])
            setSelected(previous => previous || nextCatalog?.[0]?.id || null)
          } catch (error) {
            if (sequence === loadSequence.current && expectedSessionId === clientCtx.uiSession.adapter.current.getSnapshot()?.props?.sessionId)
              setMessage({ error: true, text: String(error?.message ?? error) })
          } finally { if (!quiet) setBusy(false) }
        }, [clientCtx])

        React.useEffect(() => {
          void refresh()
          // The panel must notice a new candidate after an Agent run completes.
          // Commands are read-only; review writes additionally bind the viewed target.
          const timer = setInterval(() => {
            if (!reviewBusy.current && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) void refresh(true)
          }, 3000)
          return () => { clearInterval(timer); loadSequence.current++ }
        }, [refresh])
        React.useEffect(() => { setReviewNote('') }, [status?.run?.id, status?.run?.revision])

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

        const review = async operation => {
          if (reviewBusy.current) return
          const expectedSessionId = status?.run?.sessionId, target = status?.reviewControl?.target
          if (!expectedSessionId || !target) { setMessage({error:true,text:'当前候选信息不可用，请刷新；也可以在聊天直接说“拒绝候选”。'}); return }
          reviewBusy.current = true
          loadSequence.current++ // discard a pending pre-review refresh
          setBusy(true); setMessage(null)
          try {
            const feedback = operation === 'reject' ? ` ${reviewNote.trim() || '用户拒绝当前候选，在原任务中按已有反馈返修，保留未要求修改的内容。'}` : ''
            await runCommand(clientCtx, `/playbook review ${operation} ${target}${feedback}`, expectedSessionId)
            if (sessionIdNow() !== expectedSessionId) return
            await refresh(true)
            setMessage({ error: false, text: operation === 'accept' ? '已记录用户验收通过。' : '已拒绝候选并进入原任务返修，未取消或重建；回聊天继续即可。' })
          } catch (error) {
            if (sessionIdNow() === expectedSessionId) setMessage({ error: true, text: String(error?.message ?? error) })
          } finally { reviewBusy.current = false; setBusy(false) }
        }

        const inspectSop = async row => {
          setBusy(true); setInspectedSop(null)
          try { const sessionId = clientCtx.uiSession.adapter.current.getSnapshot()?.props?.sessionId; const value = await loadJson(clientCtx, `/playbook sop ${row.logicalId} ${row.revision}`); setInspectedSop({...value, uiSessionId:sessionId}) }
          catch(error) { setMessage({error:true,text:String(error?.message ?? error)}) }
          finally { setBusy(false) }
        }
        const approveSop = async () => {
          if (!inspectedSop || !window.confirm('确认将已查看的这个精确版本设为当前项目的已确认 SOP？活动任务保持原版本。')) return
          setBusy(true)
          try { await runCommand(clientCtx, `/playbook approve ${inspectedSop.logicalId} ${inspectedSop.revision}`, inspectedSop.uiSessionId); setInspectedSop(null); await refresh() }
          catch(error) { setMessage({error:true,text:String(error?.message ?? error)}) }
          finally { setBusy(false) }
        }

        const selectedPb = catalog.find(row => row.id === selected)
        const run = status?.run
        const stage = status?.stage
        const observations = Object.entries(status?.observations ?? {})
        return h('div', { className: 'dpb' }, [
          h('aside', { className: 'dpb-side', key: 'side' }, [
            h('section', {className:'dpb-sec',key:'project-sops'}, [
              h('strong', null, '当前项目 SOP'),
              h('div',{className:'dpb-note'}, '先读任务书并完成 intake 后显示。试用不等于已确认；查看完整定义和差异后才能批准。'),
              ...projectSops.slice(-30).map(row => h('button',{key:row.revision,className:'dpb-btn',disabled:busy,onClick:()=>inspectSop(row)}, `${row.name} · ${row.status} · ${row.revision.slice(0,8)}${row.currentDefault ? ' · 当前默认' : ''}`)),
            ]),
            h('div', { className: 'dpb-head', key: 'head' }, [
              h('div', { key: 'title' }, h('strong', null, 'Playbooks'), h('div', { className: 'dpb-note' }, `${catalog.length} 个流程`)),
              h('button', { className: 'dpb-btn', disabled: busy, onClick: () => refresh() }, busy ? '刷新中…' : '刷新'),
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
            inspectedSop ? h('section',{className:'dpb-sec',key:'sop-review'}, [
              h('strong',null,`审核项目 SOP：${inspectedSop.logicalId} / ${inspectedSop.revision.slice(0,12)}`),
              h('pre',{className:'dpb-pre'},JSON.stringify(inspectedSop,null,2)),
              h('button',{className:'dpb-btn',disabled:busy,onClick:approveSop},'确认此精确版本为项目默认'),
            ]) : null,
            h('div', { className: 'dpb-head', key: 'head' }, [
              h('div', null, h('strong', null, '当前会话'), h('div', { className: 'dpb-note' }, run ? `${run.playbookId} · ${run.state}` : '尚未运行 Playbook')),
              h('div', { className: 'dpb-actions' }, [
                selectedPb && !(status?.attached ?? status?.active) ? h('button', { className: 'dpb-btn', 'data-p': true, disabled: busy, onClick: () => start(selectedPb.id) }, `启动 ${selectedPb.id}`) : null,
                run?.state === 'awaiting_review' ? h('button', { className: 'dpb-btn', disabled: busy || !status?.reviewControl?.target, onClick: () => review('accept') }, '验收通过') : null,
                run?.state === 'awaiting_review' ? h('button', { className: 'dpb-btn', disabled: busy || !status?.reviewControl?.target, onClick: () => review('reject') }, '拒绝候选') : null,
                status?.blocker ? h('button', { className: 'dpb-btn', disabled: busy, onClick: resume }, '恢复原阶段') : null,
                (status?.attached ?? status?.active) ? h('button', { className: 'dpb-btn', 'data-d': true, disabled: busy, onClick: cancel }, '取消运行') : null,
              ]),
            ]),
            run?.state === 'awaiting_review' ? h('section', {className:'dpb-sec',key:'candidate-review'}, [
              h('strong', null, '候选待验收'),
              h('div', {className:'dpb-note'}, '不必点击按钮：在聊天直接说“拒绝候选”或“打回当前候选”同样有效。退回保留原任务与素材，不需要取消或清空。'),
              h('label', null, '返修意见（可选）', h('textarea', {
                'aria-label':'返修意见',value:reviewNote,rows:3,maxLength:24000,disabled:busy,
                onChange:event=>setReviewNote(event.target.value),
                style:{display:'block',width:'100%',marginTop:6},
                placeholder:'例如：仅替换指定镜头，其余文稿、语速和时长保持不变。',
              })),
            ]) : null,
            status?.blocker ? h('div', { className: 'dpb-status', key: 'blocker' }, `等待处理：${status.blocker.reason}`) : null,
            message ? h('div', { className: 'dpb-status', 'data-e': message.error || undefined, key: 'msg' }, message.text) : null,
            !run ? h('div', { className: 'dpb-empty', key: 'empty' }, '从左侧选择一个 Playbook 启动。运行后这里会显示 Stage、Gate 和 Harness 实际观测到的工具事实。') : h(React.Fragment, { key: 'run' }, [
              h('section', { className: 'dpb-sec', key: 'runinfo' }, [
                h('strong', null, `${run.playbookId} / ${run.stageId}`),
                h('div', { className: 'dpb-row' }, [
                  h(Badge, { kind: run.state === 'active' ? 'ok' : run.state === 'completed' ? 'ok' : 'warn' }, run.state),
                  h(Badge, null, `attempt ${run.stageAttempt}`),
                  h(Badge, null, `revision ${run.revision ?? 0}`),
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
