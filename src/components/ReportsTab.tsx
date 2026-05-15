import { FileText, Download, Share2, Eye, Calendar, Printer, Mail } from 'lucide-react';
import { type Client } from '../store/useClientStore';

const dummyReports = [
  { id: 1, name: 'Reporte Mensual - Abril 2024', date: '01 May 2024', status: 'Listo', type: 'PDF' },
  { id: 2, name: 'Q1 Strategy Wrap-up', date: '15 Abr 2024', status: 'Listo', type: 'Notion' },
  { id: 3, name: 'Auditoría de Conversión (UX)', date: '10 Mar 2024', status: 'Archivado', type: 'PDF' },
];

export function ReportsTab({ client }: { client: Client }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-center justify-between">
        <div>
           <h2 className="text-3xl font-bold text-slate-900 mb-1">Generación de Reportes</h2>
           <p className="text-slate-500 font-medium">Exportación de datos y dashboards listos para el cliente.</p>
        </div>
        <div className="flex gap-3">
           <button className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 transition-colors">
              <Calendar className="size-4" /> Programar Envío
           </button>
           <button className="bg-brand-primary text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-brand-primary/90 transition-all shadow-lg shadow-brand-primary/20">
              <FileText className="size-4" /> Nuevo Reporte
           </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
         <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden group">
            <div className="relative z-10">
               <h3 className="text-lg font-bold text-slate-900 mb-2">Reporte del Mes (Actual)</h3>
               <p className="text-sm text-slate-400 font-medium mb-6">Genera un resumen completo del periodo actual con branding de la agencia.</p>
               <div className="flex flex-wrap gap-3">
                  <button className="bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors">
                     <Download className="size-3" /> Descargar PDF
                  </button>
                  <button className="bg-slate-100 text-slate-600 px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-slate-200 transition-colors">
                     <Share2 className="size-3" /> Enviar a Cliente
                  </button>
               </div>
            </div>
            <FileText className="absolute -right-4 -bottom-4 size-32 text-slate-50 group-hover:text-slate-100 transition-colors" />
         </div>

         <div className="bg-brand-secondary/5 p-8 rounded-3xl border border-brand-secondary/10 shadow-sm relative overflow-hidden group">
            <div className="relative z-10">
               <h3 className="text-lg font-bold text-brand-secondary mb-2">Sincronización con Notion</h3>
               <p className="text-sm text-slate-500 font-medium mb-6">Manten el dashboard del cliente actualizado automáticamente en tiempo real.</p>
               <button className="text-brand-secondary font-bold text-xs flex items-center gap-2 hover:translate-x-1 transition-transform">
                  Configurar Integración Notion <Share2 className="size-3" />
               </button>
            </div>
            <div className="absolute top-4 right-4 size-10 bg-white rounded-xl shadow-sm flex items-center justify-center opacity-50 group-hover:opacity-100 transition-opacity">
               <Share2 className="size-5 text-brand-secondary" />
            </div>
         </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
         <div className="p-6 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Historial de Reportes</h3>
         </div>
         <div className="divide-y divide-slate-100">
            {dummyReports.map((report) => (
               <div key={report.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                     <div className="size-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400">
                        <FileText className="size-5" />
                     </div>
                     <div>
                        <h4 className="text-sm font-bold text-slate-900">{report.name}</h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{report.date} • {report.type}</p>
                     </div>
                  </div>
                  <div className="flex items-center gap-6">
                     <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">{report.status}</span>
                     <div className="flex gap-2">
                        <button className="p-2 text-slate-400 hover:text-brand-primary transition-colors cursor-pointer" title="Vista Previa">
                           <Eye className="size-4" />
                        </button>
                        <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" title="Descargar">
                           <Download className="size-4" />
                        </button>
                        <button className="p-2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" title="Enviar por Email">
                           <Mail className="size-4" />
                        </button>
                     </div>
                  </div>
               </div>
            ))}
         </div>
      </div>
    </div>
  );
}
