import { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import clsx from 'clsx'

interface SortableItemProps {
  id: string;
  children: ReactNode;
  className?: string;
  /** Show drag handle inside (true) or make whole item draggable (false) */
  withHandle?: boolean;
}

export default function SortableItem({ id, children, className, withHandle = true }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        "relative group transition-shadow h-full",
        isDragging && "opacity-60 shadow-2xl shadow-indigo-500/30 ring-2 ring-indigo-400/60 rounded-2xl",
        className,
      )}
      {...(withHandle ? attributes : { ...attributes, ...listeners })}
    >
      {withHandle && (
        <button
          ref={setActivatorNodeRef}
          {...listeners}
          className="absolute top-2 right-2 z-10 p-1 rounded-md text-slate-600 hover:text-slate-300 hover:bg-slate-800/80 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>
      )}
      {children}
    </div>
  )
}
