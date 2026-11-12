export const scanPhases = ['starting', 'es', 'us', 'review', 'checking', 'selection', 'publishing', 'completed', 'failed', 'cancelled'];
export const scanStatusUrl = 'https://raw.githubusercontent.com/Lootura/web/scan-status/status.json';
export const scanStatusApiUrl = 'https://api.github.com/repos/Lootura/web/contents/status.json?ref=scan-status';
export const scanLeaseMs = 4 * 60_000;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const metricNames = ['sources', 'analyzed', 'newEntities'];
export const scanHistoryRetentionMs = 24 * 60 * 60_000;

export function scanCounts(value) {
  return Object.fromEntries(['es', 'us'].filter(edition => value?.[edition]).map(edition =>
    [edition, Object.fromEntries(metricNames.map(key => [key, count(value[edition][key])]))]));
}

// Reconstruct an allowlist: never publish log messages, URLs, credentials or AI results.
export function publicScanRun(value) {
  if (!value || !/^[\w-]{1,100}$/.test(value.id || '') || !scanPhases.includes(value.phase)
    || !['running', 'completed', 'failed', 'cancelled'].includes(value.state)
    || (value.state === 'running' ? ['completed','failed','cancelled'].includes(value.phase) : value.phase !== value.state)
    || !timestamp(value.startedAt) || !timestamp(value.updatedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.startedAt)) return null;
  const events = (Array.isArray(value.events) ? value.events : []).slice(-16)
    .filter(event => scanPhases.includes(event.phase) && timestamp(event.at)
      && Date.parse(event.at) >= Date.parse(value.startedAt) && Date.parse(event.at) <= Date.parse(value.updatedAt))
    .map(({phase, at}) => ({phase, at}));
  const counts = scanCounts(value.counts);
  const totals = Object.fromEntries(metricNames.map(key => {
    const values = Object.values(counts).map(metrics => metrics[key]).filter(value => value !== null);
    return [key, values.length ? count(values.reduce((a, b) => a + b, 0)) : count(value[key])];
  }));
  return {id: value.id, phase: value.phase, state: value.state, startedAt: value.startedAt, updatedAt: value.updatedAt,
    events, ...totals, counts, items: count(value.items)};
}

export function groupEditionRuns(runs, {now = Date.now(), pairWindowMs = 15 * 60_000} = {}) {
  const cutoff = now - scanHistoryRetentionMs;
  const entries = (Array.isArray(runs) ? runs : []).filter(run => typeof run?.id === 'string' && ['es', 'us'].includes(run.profile)
    && timestamp(run.startedAt) && timestamp(run.finishedAt) && Date.parse(run.finishedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const used = new Set(), cycles = [];
  for (const entry of entries) {
    if (used.has(entry.id)) continue;
    const counterpart = entries.filter(other => !used.has(other.id) && other.id !== entry.id && other.profile !== entry.profile
      && Math.abs(Date.parse(other.startedAt) - Date.parse(entry.startedAt)) <= pairWindowMs)
      .sort((a, b) => Math.abs(Date.parse(a.startedAt) - Date.parse(entry.startedAt)) - Math.abs(Date.parse(b.startedAt) - Date.parse(entry.startedAt)))[0];
    const editions = [entry, ...(counterpart ? [counterpart] : [])].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    for (const edition of editions) used.add(edition.id);
    const startedAt = editions[0].startedAt;
    const updatedAt = editions.reduce((latest, edition) => Date.parse(edition.finishedAt) > Date.parse(latest) ? edition.finishedAt : latest, editions[0].finishedAt);
    const state = editions.some(edition => edition.state !== 'completed') ? 'failed' : 'completed';
    const counts = Object.fromEntries(editions.map(edition => {
      const metrics = {...(edition.scanCounts?.[edition.profile] || {})};
      if (!Number.isSafeInteger(metrics.sources)) metrics.sources = Number.isSafeInteger(edition.feedCount) ? edition.feedCount : null;
      if (metrics.analyzed === 0 && Number.isSafeInteger(edition.processedCount) && edition.processedCount > 0) metrics.analyzed = edition.processedCount;
      if (!Number.isSafeInteger(metrics.analyzed)) metrics.analyzed = Number.isSafeInteger(edition.processedCount) ? edition.processedCount : null;
      if (!Number.isSafeInteger(metrics.newEntities)) metrics.newEntities = null;
      return [edition.profile, metrics];
    }));
    const events = [{phase: 'starting', at: startedAt}, ...editions.map(edition => ({phase: edition.profile, at: edition.startedAt})), {phase: state, at: updatedAt}];
    cycles.push(publicScanRun({id: `cycle-${Date.parse(startedAt)}`, phase: state, state, startedAt, updatedAt, events, counts,
      items: editions.reduce((sum, edition) => sum + Number(edition.fetchedItemCount || edition.processedCount || edition.itemCount || 0), 0)}));
  }
  return cycles.filter(Boolean).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function publicScanSnapshot(value, {now = Date.now()} = {}) {
  if (value?.schemaVersion !== 1) return null;
  const cutoff = now - scanHistoryRetentionMs;
  const retained = item => Date.parse(item.updatedAt) >= cutoff;
  const candidateRun = publicScanRun(value.run);
  const run = candidateRun && retained(candidateRun) ? candidateRun : null;
  return {schemaVersion: 1, run, history: (Array.isArray(value.history) ? value.history : [])
    .map(publicScanRun).filter(Boolean).filter(item => retained(item) && item.id !== run?.id).slice(0, 12)};
}
export function scanIsActive(run, now = Date.now()) {
  const age = now - Date.parse(run?.updatedAt);
  return run?.state === 'running' && age >= -60_000 && age <= scanLeaseMs;
}
export function scanPhaseLabel(phase, lang = 'es') {
  const es = {starting:'Iniciando el rastreo', es:'Leyendo medios de España', us:'Leyendo medios de EE. UU.', review:'Revisando relaciones', checking:'Comprobando los datos', selection:'Seleccionando la portada', publishing:'Publicando', completed:'Ejecución terminada', failed:'Ejecución interrumpida', cancelled:'Ejecución cancelada'};
  const en = {starting:'Starting the scan', es:'Reading Spanish publications', us:'Reading US publications', review:'Reviewing relationships', checking:'Checking the data', selection:'Selecting the front page', publishing:'Publishing', completed:'Run finished', failed:'Run interrupted', cancelled:'Run cancelled'};
  return (lang === 'es' ? es : en)[phase] || (lang === 'es' ? 'Esperando el próximo rastreo' : 'Waiting for the next scan');
}

export function scanTimeline(run,{now=Date.now(),connected=true}={}){
  if(!run)return [];
  const events=run.events||[],terminal=['completed','failed','cancelled'];
  const lastWork=events.findLastIndex(event=>!terminal.includes(event.phase));
  return events.map((event,index)=>{
    let status='completed';
    if(terminal.includes(event.phase))status=event.phase;
    else if(index===lastWork){
      status=run.state==='running'?(connected&&scanIsActive(run,now)?'running':'unknown'):run.state;
    }
    return {...event,key:`${run.id}:${index}:${event.phase}:${event.at}`,status};
  });
}

export function scanStepStatusLabel(status,lang='es'){
 const es={completed:'Hecho',running:'Activo',failed:'Error',cancelled:'Cancelado',unknown:'Pendiente',waiting:'Pendiente',skipped:'Omitido'};
 const en={completed:'Done',running:'Active',failed:'Failed',cancelled:'Cancelled',unknown:'Unconfirmed',waiting:'Pending',skipped:'Skipped'};
 return (lang==='es'?es:en)[status]||'';
}

// A phase counter, not an estimate of elapsed work. Missing phases never become green.
export function scanFlow(run, options = {}) {
  const timeline = scanTimeline(run, options);
  const editionStart=timeline.findLastIndex(event=>event.phase==='es'||event.phase==='us');
  // ES and US execute sequentially. A fresh US phase must not inherit ES's green steps.
  const recorded=run?.state!=='completed'&&editionStart>=0?timeline.filter((event,index)=>event.phase==='starting'||index>=editionStart):timeline;
  const phases = ['starting', 'headlines', 'review', 'checking', 'selection', 'publishing', 'completed'];
  const terminal = run && run.state !== 'running';
  const current = phases.indexOf(run?.phase);
  const steps = phases.map((phase, index) => {
    if (phase === 'headlines') {
      const events = recorded.filter(event => event.phase === 'es' || event.phase === 'us');
      const states = events.map(event => event.status);
      const status = states.includes('running') ? 'running' : states.includes('unknown') ? 'unknown'
        : states.includes('failed') ? 'failed' : states.includes('completed') ? 'completed' : terminal ? 'skipped' : 'waiting';
      return {key: `${run?.id || 'pending'}:headlines`, phase, at: events.at(-1)?.at || null, status};
    }
    const event = recorded.findLast(event => event.phase === phase || (phase === 'completed' && ['failed', 'cancelled'].includes(event.phase)));
    return event || {key: `${run?.id || 'pending'}:${phase}`, phase, at: null,
      status: terminal || index < current ? 'skipped' : 'waiting'};
  });
  return {steps, completed: steps.filter(step => step.status === 'completed').length, total: steps.filter(step => step.status !== 'skipped').length};
}

export function scanActivityLabel(phase,lang='es'){
 const es={starting:'Inicio',headlines:'Lectura de titulares',es:'Lectura de titulares',us:'Lectura de titulares',review:'Análisis de relaciones',checking:'Validación de datos',selection:'Selección de portada',publishing:'Publicación',completed:'Finalizado',failed:'Error',cancelled:'Cancelado'};
 const en={starting:'Starting',headlines:'Reading headlines',es:'Reading headlines',us:'Reading headlines',review:'Relation analysis',checking:'Data validation',selection:'Front-page selection',publishing:'Publishing',completed:'Finished',failed:'Failed',cancelled:'Cancelled'};
 return (lang==='es'?es:en)[phase]||(lang==='es'?'Pendiente':'Pending');
}

export function scanTimelineLabel(phase,lang='es'){
 const es={starting:'Inicio',headlines:'Titulares',es:'Titulares',us:'Titulares',review:'Análisis',checking:'Validación',selection:'Portada',publishing:'Publicación',completed:'Finalizado',failed:'Error',cancelled:'Cancelado'};
 const en={starting:'Start',headlines:'Headlines',es:'Headlines',us:'Headlines',review:'Analysis',checking:'Validate',selection:'Cover',publishing:'Publish',completed:'Done',failed:'Failed',cancelled:'Cancelled'};
 return (lang==='es'?es:en)[phase]||(lang==='es'?'Pendiente':'Pending');
}
