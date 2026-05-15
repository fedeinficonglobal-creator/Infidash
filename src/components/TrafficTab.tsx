import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { BarChart3, Target, Globe, MousePointer2, TrendingUp, TrendingDown } from 'lucide-react';
import { type Client } from '../store/useClientStore';

const adsData = [
  { name: '1 May', google: 420, meta: 380, roas: 4.2 },
  { name: '5 May', google: 550, meta: 410, roas: 4.4 },
  { name: '10 May', google: 480, meta: 520, roas: 4.1 },
  { name: '15 May', google: 600, meta: 580, roas: 4.8 },
  { name: '20 May', google: 720, meta: 650, roas: 5.1 },
  { name: '25 May', google: 680, meta: 820, roas: 4.9 },
  { name: '30 May', google: 750, meta: 910, roas: 5.2 },
];

export function TrafficTab({ client }: { client: Client }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Tráfico & Ads (GA4 + Ads)</h2>
        <p className="text-slate-500 font-medium">Comparativa de canales y rendimiento de campañas pagadas.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
         <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Gasto Ads Total</p>
            <div className="flex items-center justify-between">
               <h3 className="text-xl font-bold">12.450 €</h3>
               <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">+5.2%</span>
            </div>
         </div>
         <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Conversiones Ads</p>
            <div className="flex items-center justify-between">
               <h3 className="text-xl font-bold">842</h3>
               <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">+12.1%</span>
            </div>
         </div>
         <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">CPA Global</p>
            <div className="flex items-center justify-between">
               <h3 className="text-xl font-bold">14,78 €</h3>
               <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">-8.4%</span>
            </div>
         </div>
         <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">ROAS Combinado</p>
            <div className="flex items-center justify-between">
               <h3 className="text-xl font-bold">4.21x</h3>
               <span className="text-[10px] text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded">-2.1%</span>
            </div>
         </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm mb-8">
        <div className="flex items-center justify-between mb-8">
           <div>
              <h3 className="text-lg font-bold text-slate-900">Gasto Publicitario por Canal</h3>
              <p className="text-xs text-slate-400 font-medium">GOOGLE ADS VS META ADS</p>
           </div>
           <div className="flex gap-4">
              <div className="flex items-center gap-2">
                 <div className="size-3 rounded-full bg-blue-500" />
                 <span className="text-xs font-bold text-slate-600">Google Ads</span>
              </div>
              <div className="flex items-center gap-2">
                 <div className="size-3 rounded-full bg-rose-500" />
                 <span className="text-xs font-bold text-slate-600">Meta Ads</span>
              </div>
           </div>
        </div>
        <div className="h-[350px] w-full">
           <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={adsData}>
                <defs>
                   <linearGradient id="colorGoogle" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                   </linearGradient>
                   <linearGradient id="colorMeta" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                   </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                <Area type="monotone" dataKey="google" stroke="#3b82f6" strokeWidth={3} fill="url(#colorGoogle)" />
                <Area type="monotone" dataKey="meta" stroke="#f43f5e" strokeWidth={3} fill="url(#colorMeta)" />
              </AreaChart>
           </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
               <Globe className="size-5 text-slate-400" /> Canales de Tráfico (GA4)
            </h3>
            <div className="space-y-4">
               {[
                  { channel: 'Paid Search', sessions: '45.2K', share: 45, trend: 'up' },
                  { channel: 'Direct', sessions: '22.1K', share: 22, trend: 'up' },
                  { channel: 'Organic Search', sessions: '18.4K', share: 18, trend: 'down' },
                  { channel: 'Social Paid', sessions: '12.4K', share: 12, trend: 'up' },
                  { channel: 'Referral', sessions: '3.1K', share: 3, trend: 'neutral' },
               ].map((c) => (
                  <div key={c.channel} className="space-y-1.5">
                     <div className="flex justify-between items-end">
                        <span className="text-sm font-bold text-slate-700">{c.channel}</span>
                        <div className="flex items-center gap-2">
                           <span className="text-xs font-medium text-slate-500">{c.sessions} ses.</span>
                           {c.trend === 'up' ? <TrendingUp className="size-3 text-emerald-500" /> : <TrendingDown className="size-3 text-rose-500" />}
                        </div>
                     </div>
                     <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-primary rounded-full transition-all duration-1000" style={{ width: `${c.share}%` }} />
                     </div>
                  </div>
               ))}
            </div>
         </div>

         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
            <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
               <Target className="size-5 text-slate-400" /> Campañas con Mejor ROAS
            </h3>
            <div className="space-y-3">
               {[
                  { name: 'PMax - Core Products', roas: '6.4x', spend: '4.200 €' },
                  { name: 'Meta - Prospecting Women', roas: '5.8x', spend: '2.100 €' },
                  { name: 'Google - Brand Search', roas: '12.4x', spend: '850 €' },
                  { name: 'Remarketing Dynamics', roas: '4.2x', spend: '1.500 €' },
               ].map((camp) => (
                  <div key={camp.name} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                     <div>
                        <p className="text-sm font-bold text-slate-900">{camp.name}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Inversión: {camp.spend}</p>
                     </div>
                     <div className="text-right">
                        <p className="text-lg font-bold text-brand-primary">{camp.roas}</p>
                        <span className="text-[10px] text-emerald-600 font-bold">TOP ROAS</span>
                     </div>
                  </div>
               ))}
            </div>
         </div>
      </div>
    </div>
  );
}
