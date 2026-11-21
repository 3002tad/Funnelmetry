import { useOutletContext } from 'react-router-dom'
import type { ShellContext } from '../../app/AppShell'
import { ReferenceCdcCandidatePanel } from './ReferenceCdcCandidatePanel'

export function FunnelsPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  return <ReferenceCdcCandidatePanel sourceId={sourceId} range={range}/>
}
