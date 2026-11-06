import {useAuth} from '../../auth/AuthContext'
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
export function DesignDialog({ title, onClose, children }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const {user}=useAuth();const ref = useRef<HTMLElement>(null), closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => { const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; const main = document.querySelector<HTMLElement>('[data-template-content]'), sidebar = document.querySelector<HTMLElement>('[data-template-sidebar]'); const oldMain = main?.inert, oldSide = sidebar?.inert; if (main)
        main.inert = true; if (sidebar)
        sidebar.inert = true; ref.current?.querySelector<HTMLElement>('input,button,select,a[href]')?.focus(); const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
    } if (e.key === 'Tab') {
        const nodes = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')];
        if (!nodes.length)
            return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    } }; document.addEventListener('keydown', handle); return () => { document.body.style.overflow = overflow; if (main)
        main.inert = oldMain ?? false; if (sidebar)
        sidebar.inert = oldSide ?? false; document.removeEventListener('keydown', handle); previous?.focus(); }; }, []);
    return createPortal(<div className="template-root template-portal" data-ui={user?.role==='super_admin'?'admin':'analyst'}><div className="tpl-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget)
        onClose(); }}><section ref={ref} className="tpl-modal" role="dialog" aria-modal="true" aria-label={title}><div className="tpl-row tpl-between"><h2>{title}</h2><button type="button" aria-label="Đóng" onClick={onClose}><X size={17}/></button></div>{children}</section></div></div>, document.body);
}
