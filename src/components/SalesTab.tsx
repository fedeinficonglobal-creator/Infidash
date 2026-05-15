import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ShoppingBag, TrendingUp, Users, Package, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { type Client } from '../store/useClientStore';

const salesData = [
  { name: 'Lun', sales: 4200 },
  { name: 'Mar', sales: 3800 },
  { name: 'Mie', sales: 5100 },
  { name: 'Jue', sales: 4600 },
  { name: 'Vie', sales: 6200 },
  { name: 'Sab', sales: 7500 },
  { name: 'Dom', sales: 6800 },
];

const categoryData = [
  { name: 'Vestidos', value: 400 },
  { name: 'Zapatos', value: 300 },
  { name: 'Bolsos', value: 300 },
  { name: 'Accesorios', value: 200 },
];

const COLORS = ['#0ea5e9', '#6366f1', '#f43f5e', '#fbbf24'];

export function SalesTab({ client }: { client: Client }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-1">Rendimiento WooCommerce</h2>
        <p className="text-slate-500 font-medium">Análisis detallado de ventas, productos y pedidos.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-4 text-emerald-600">
               <TrendingUp className="size-5" />
               <span className="text-xs font-bold uppercase tracking-widest">Ingresos Totales</span>
            </div>
            <h3 className="text-2xl font-bold">52.430 €</h3>
            <p className="text-xs text-slate-400 mt-1">+12.5% vs mes anterior</p>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-4 text-blue-600">
               <Package className="size-5" />
               <span className="text-xs font-bold uppercase tracking-widest">Pedidos</span>
            </div>
            <h3 className="text-2xl font-bold">1.240</h3>
            <p className="text-xs text-slate-400 mt-1">+8.1% vs mes anterior</p>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-4 text-amber-600">
               <Users className="size-5" />
               <span className="text-xs font-bold uppercase tracking-widest">Ticket Medio (AOV)</span>
            </div>
            <h3 className="text-2xl font-bold">42,28 €</h3>
            <p className="text-xs text-slate-400 mt-1">+4.2% vs mes anterior</p>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Ventas por Día (Esta Semana)</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none' }} />
                <Bar dataKey="sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Categorías Top</h3>
          <div className="h-[300px] w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
               {categoryData.map((c, i) => (
                  <div key={c.name} className="flex items-center gap-2">
                     <div className="size-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                     <span className="text-xs font-bold text-slate-600 truncate w-24">{c.name}</span>
                     <span className="text-xs font-medium text-slate-400">{Math.round(c.value / 12)}%</span>
                  </div>
               ))}
            </div>
          </div>
        </div>
      </div>

      {/* Abandoned Carts Section */}
      <div className="bg-rose-50 border border-rose-100 p-6 rounded-2xl">
         <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
               <div className="size-10 bg-rose-500 rounded-xl flex items-center justify-center text-white">
                  <ArrowDownRight className="size-6" />
               </div>
               <div>
                  <h3 className="text-lg font-bold text-rose-900">Carritos Abandonados</h3>
                  <p className="text-sm text-rose-700">Oportunidad de recuperación detectada.</p>
               </div>
            </div>
            <div className="text-right">
               <p className="text-2xl font-bold text-rose-900">420 €</p>
               <p className="text-xs text-rose-600 font-bold uppercase">Potencial Recuperable Hoy</p>
            </div>
         </div>
      </div>
    </div>
  );
}
