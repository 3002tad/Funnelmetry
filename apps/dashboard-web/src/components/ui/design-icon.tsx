const shapes:Record<string,string>={
 overview:'M3 3v18h18 M7 14l4-4 4 3 6-8',filter:'M3 4h18l-7 8v7l-4 2v-9z',shopping:'M6 7h12l2 14H4L6 7 M9 7V5a3 3 0 0 1 6 0v2',
 activity:'M2 12h5l3-8 4 16 3-8h5',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8 M3 12h4l2-4 4 8 2-4h6',
 source:'M12 3v6 M5 21v-5h14v5 M5 16v-4h14v4 M12 12V9',search:'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 users:'M16 21v-3c0-5-12-5-12 0v3 M10 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4c5 0 5 7 0 7 M19 14c3 1 3 4 3 6',audit:'M8 4H4v18h16V4h-4 M8 2h8v5H8z M8 12h8 M8 16h5',
 settings:'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',bot:'M9 3h6 M12 3v4 M5 7h14v13H5z M2 11v5 M22 11v5 M9 11v2 M15 11v2 M9 17h6',
 external:'M14 3h7v7 M21 3l-10 10 M10 4H4v16h16v-6',shield:'M12 3l9 4v6c0 5-9 9-9 9s-9-4-9-9V7z M8 12l3 3 5-6',
}
export const navigationSymbols:Record<string,string>={'/overview':'overview','/funnels':'filter','/products':'shopping','/events':'activity','/data-health':'heart','/admin/pipeline':'activity','/admin/scaling':'activity','/admin/recovery':'shield','/admin/sources':'source','/admin/investigate':'search','/admin/users':'users','/admin/audit':'audit'}
export function DesignIcon({name,size=17,className=''}:{name:string;size?:number;className?:string}){return <svg width={size} height={size} className={`tpl-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={shapes[name]||shapes.overview}/></svg>}
