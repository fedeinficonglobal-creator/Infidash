import { useState } from 'react';
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Hash, TrendingUp, Users, Heart, Share2, Eye, MessageSquare } from 'lucide-react';
import { type Client } from '../store/useClientStore';
import { cn } from '../lib/utils';

const engagementData = [
  { name: 'Lun', views: 4200, likes: 450 },
  { name: 'Mar', views: 3800, likes: 380 },
  { name: 'Mie', views: 8100, likes: 920 },
  { name: 'Jue', views: 5600, likes: 580 },
  { name: 'Vie', views: 6200, likes: 650 },
  { name: 'Sab', views: 12500, likes: 1400 },
  { name: 'Dom', views: 10800, likes: 1100 },
];

export function RrssTab({ client }: { client: Client }) {
  const [activePlatform, setActivePlatform] = useState<string>('all');

  const platforms = [
    { id: 'all', label: 'Todos', icon: Hash },
    { id: 'instagram', label: 'Instagram', color: 'bg-rose-500' },
    { id: 'facebook', label: 'Facebook', color: 'bg-blue-600' },
    { id: 'tiktok', label: 'TikTok', color: 'bg-black' },
    { id: 'linkedin', label: 'LinkedIn', color: 'bg-blue-700' },
    { id: 'twitter', label: 'X (Twitter)', color: 'bg-slate-900' },
    { id: 'youtube', label: 'YouTube', color: 'bg-rose-600' },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
           <h2 className="text-3xl font-bold text-slate-900 mb-1 flex items-center gap-3">
              Redes Sociales
           </h2>
           <p className="text-slate-500 font-medium">Métricas de engagement, impresiones y crecimiento de comunidad.</p>
        </div>
        <div className="flex bg-white border border-slate-100 p-1 rounded-xl shadow-sm overflow-x-auto no-scrollbar max-w-full">
           {platforms.map((p) => (
             <button
               key={p.id}
               onClick={() => setActivePlatform(p.id)}
               className={cn(
                 "px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-2",
                 activePlatform === p.id ? "bg-slate-900 text-white shadow-md" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
               )}
             >
               {p.icon ? <p.icon className="size-3" /> : (
                 <div className={cn("size-2 rounded-full", p.color)} />
               )}
               {p.label}
             </button>
           ))}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
         <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex justify-between mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Seguidores</p>
                <Users className="size-4 text-slate-400" />
            </div>
            <div className="flex items-center justify-between">
               <h3 className="text-2xl font-bold">45.2K</h3>
               <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">+1.2K</span>
            </div>
         </div>
         <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex justify-between mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Impresiones (7d)</p>
                <Eye className="size-4 text-slate-400" />
            </div>
            <div className="flex items-center justify-between">
               <h3 className="text-2xl font-bold">512K</h3>
               <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">+15%</span>
            </div>
         </div>
         <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex justify-between mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Interacciones</p>
                <Heart className="size-4 text-rose-400" />
            </div>
            <div className="flex items-center justify-between">
               <h3 className="text-2xl font-bold">24.5K</h3>
               <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">+8.4%</span>
            </div>
         </div>
         <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex justify-between mb-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Engagement Rate</p>
                <TrendingUp className="size-4 text-slate-400" />
            </div>
            <div className="flex items-center justify-between">
               <h3 className="text-2xl font-bold">4.8%</h3>
               <span className="text-[10px] text-rose-600 font-bold bg-rose-50 px-1.5 py-0.5 rounded">-0.2%</span>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Alcance e Impresiones</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={engagementData}>
                 <defs>
                   <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                     <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                   </linearGradient>
                 </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                <Area type="monotone" dataKey="views" name="Impresiones" stroke="#8b5cf6" strokeWidth={3} fill="url(#colorViews)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Rendimiento de Posts</h3>
          <div className="space-y-4">
             {[
               { id: 1, type: 'Reel', title: 'Nueva colección de verano 🌴', views: '125K', likes: '8.4K', comments: 342, platform: 'Instagram' },
               { id: 2, type: 'Carousel', title: '5 tips para tu setup 💻', views: '45K', likes: '2.1K', comments: 128, platform: 'LinkedIn' },
               { id: 3, type: 'Post', title: 'Sorteo aniversario 🎉', views: '28K', likes: '3.5K', comments: 1240, platform: 'Instagram' },
               { id: 4, type: 'Video', title: 'Detrás de escena: producción', views: '18K', likes: '950', comments: 45, platform: 'TikTok' },
             ].map((post) => (
                <div key={post.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                   <div className="flex items-center gap-3">
                      <div className={cn(
                        "size-10 rounded-lg flex items-center justify-center font-bold text-xs uppercase text-white shadow-sm",
                        post.platform === 'Instagram' ? "bg-gradient-to-tr from-yellow-400 via-rose-500 to-purple-500" :
                        post.platform === 'TikTok' ? "bg-black" : "bg-blue-600"
                      )}>
                         {post.platform.substring(0, 2)}
                      </div>
                      <div>
                         <p className="text-sm font-bold text-slate-900 truncate max-w-[150px] sm:max-w-xs">{post.title}</p>
                         <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{post.type}</p>
                      </div>
                   </div>
                   <div className="flex items-center gap-4">
                      <div className="text-right hidden sm:block">
                         <div className="flex items-center gap-1 text-slate-500 justify-end">
                            <Eye className="size-3" />
                            <span className="text-xs font-bold">{post.views}</span>
                         </div>
                      </div>
                      <div className="text-right">
                         <div className="flex items-center gap-1 text-rose-500 justify-end">
                            <Heart className="size-3" />
                            <span className="text-xs font-bold">{post.likes}</span>
                         </div>
                         <div className="flex items-center gap-1 text-blue-500 justify-end">
                            <MessageSquare className="size-3" />
                            <span className="text-xs font-bold">{post.comments}</span>
                         </div>
                      </div>
                   </div>
                </div>
             ))}
          </div>
        </div>
      </div>
    </div>
  );
}
