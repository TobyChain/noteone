"""
ArXiv AI Agent Web 界面
基于 Streamlit 的可视化浏览平台
"""

import os
import html
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
from collections import Counter
import sys
from pathlib import Path

# 添加项目路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# 切换到项目目录，确保数据库路径正确
os.chdir(project_root)

from src.database.connection import init_database, get_db_session
from src.database.repositories import PaperRepository
from src.core.query_engine import PaperQueryEngine, TrendAnalyzer, SearchCriteria
from src.core.scoring import ResearchDirection


# ==================== 页面配置 ====================

st.set_page_config(
    page_title="ArXiv AI Agent",
    page_icon="📚",
    layout="wide",
    initial_sidebar_state="expanded"
)

# 自定义样式 - 深色主题配色
st.markdown("""
<style>
    /* ==================== 深色主题配色 ==================== */
    
    /* 全局深色背景 */
    .main {
        background-color: #1a1d23;
    }
    
    /* 主内容区域 */
    .main .block-container {
        color: #e8eaed;
        background-color: #1a1d23;
    }
    
    /* 侧边栏深色主题 */
    [data-testid="stSidebar"] {
        background-color: #242831;
        border-right: 1px solid #3a3f4b;
    }
    
    [data-testid="stSidebar"] .block-container {
        color: #e8eaed;
    }
    
    /* 标题样式 - 亮色文字 */
    h1 {
        color: #ffffff !important;
        font-weight: 700;
        border-bottom: 3px solid #1f77b4;
        padding-bottom: 0.5rem;
        margin-bottom: 1.5rem;
    }
    
    h2 {
        color: #f0f0f0 !important;
        font-weight: 600;
        margin-top: 2rem;
        margin-bottom: 1rem;
    }
    
    h3 {
        color: #e8eaed !important;
        font-weight: 600;
    }
    
    h4 {
        color: #e8eaed !important;
        font-weight: 500;
    }
    
    /* 普通文字 - 亮色确保可读 */
    p, div, span, label {
        color: #e8eaed !important;
    }
    
    /* Markdown内容 */
    .stMarkdown {
        color: #e8eaed !important;
    }
    
    /* Metric卡片 - 深色背景 */
    [data-testid="stMetric"] {
        background-color: #2d3139;
        padding: 1rem;
        border-radius: 8px;
        border: 1px solid #3a3f4b;
    }
    
    [data-testid="stMetricValue"] {
        font-size: 2rem;
        font-weight: 700;
        color: #ffffff !important;
    }
    
    [data-testid="stMetricLabel"] {
        font-size: 0.9rem;
        color: #b0b3b8 !important;
        font-weight: 500;
    }
    
    [data-testid="stMetricDelta"] {
        color: #b0b3b8 !important;
    }
    
    /* 按钮样式 */
    .stButton > button {
        background-color: #1f77b4;
        color: #ffffff !important;
        border: none;
        border-radius: 8px;
        padding: 0.5rem 2rem;
        font-weight: 600;
        transition: all 0.3s ease;
    }
    
    .stButton > button:hover {
        background-color: #2e8bc0;
        box-shadow: 0 4px 12px rgba(31, 119, 180, 0.4);
        transform: translateY(-2px);
    }
    
    .stButton > button[kind="primary"] {
        background-color: #1f77b4;
    }
    
    /* 输入框样式 - 深色 */
    .stTextInput > div > div > input {
        border-radius: 8px;
        border: 2px solid #3a3f4b;
        padding: 0.5rem;
        color: #ffffff !important;
        background-color: #2d3139 !important;
        transition: border-color 0.3s ease;
    }
    
    .stTextInput > div > div > input:focus {
        border-color: #1f77b4;
        box-shadow: 0 0 0 2px rgba(31, 119, 180, 0.2);
    }
    
    .stTextInput > div > div > input::placeholder {
        color: #6c757d !important;
    }
    
    .stTextInput label {
        color: #e8eaed !important;
        font-weight: 500;
    }
    
    /* Selectbox样式 - 深色 */
    .stSelectbox > div > div {
        border-radius: 8px;
        background-color: #2d3139;
    }
    
    .stSelectbox label {
        color: #e8eaed !important;
        font-weight: 500;
    }
    
    .stSelectbox [data-baseweb="select"] {
        background-color: #2d3139 !important;
        border-color: #3a3f4b !important;
    }
    
    .stSelectbox [data-baseweb="select"] > div {
        color: #ffffff !important;
        background-color: #2d3139 !important;
    }
    
    /* Radio按钮 */
    .stRadio label {
        color: #e8eaed !important;
    }
    
    .stRadio > div {
        color: #e8eaed !important;
    }
    
    /* Slider */
    .stSlider label {
        color: #e8eaed !important;
        font-weight: 500;
    }
    
    /* Date Input */
    .stDateInput label {
        color: #e8eaed !important;
        font-weight: 500;
    }
    
    .stDateInput input {
        background-color: #2d3139 !important;
        color: #ffffff !important;
        border-color: #3a3f4b !important;
    }
    
    /* Expander样式 - 深色 */
    .streamlit-expanderHeader {
        background-color: #2d3139;
        border: 1px solid #3a3f4b;
        border-radius: 8px;
        font-weight: 500;
        color: #e8eaed !important;
    }
    
    .streamlit-expanderHeader:hover {
        background-color: #353a44;
        border-color: #1f77b4;
    }
    
    .streamlit-expanderContent {
        background-color: #242831;
        border: 1px solid #3a3f4b;
        border-top: none;
        color: #e8eaed !important;
    }
    
    /* 链接按钮样式 */
    .stLinkButton > a {
        background-color: #2d3139;
        color: #e8eaed !important;
        border: 1px solid #3a3f4b;
        border-radius: 6px;
        padding: 0.4rem 1rem;
        text-decoration: none;
        font-weight: 500;
        transition: all 0.2s ease;
    }
    
    .stLinkButton > a:hover {
        background-color: #1f77b4;
        color: #ffffff !important;
        border-color: #1f77b4;
        transform: scale(1.05);
    }
    
    /* 图表容器 - 深色 */
    .js-plotly-plot {
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        background-color: #2d3139 !important;
    }
    
    /* Info/Warning/Success/Error 消息框 - 深色 */
    .stAlert {
        background-color: #2d3139;
        color: #e8eaed;
        border: 1px solid #3a3f4b;
    }
    
    /* Divider 分隔线 */
    hr {
        margin: 2rem 0;
        border: none;
        border-top: 2px solid #3a3f4b;
    }
    
    /* Container 容器 */
    [data-testid="stVerticalBlock"] {
        background-color: transparent;
    }
    
    /* 卡片容器 */
    [data-testid="stHorizontalBlock"] {
        background-color: transparent;
    }
    
    /* 确保所有文本都是亮色 */
    * {
        color: #e8eaed;
    }
    
    /* 链接颜色 */
    a {
        color: #4da6ff !important;
    }
    
    a:hover {
        color: #66b3ff !important;
    }
    
    /* 代码块 - 深色 */
    code {
        background-color: #2d3139;
        color: #ff6b6b;
        padding: 0.2rem 0.4rem;
        border-radius: 4px;
        border: 1px solid #3a3f4b;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }
    
    /* 引用块 - 简化样式 */
    blockquote {
        border-left: 4px solid #1f77b4;
        padding-left: 1rem;
        color: #e8eaed;
        margin: 1rem 0;
        background-color: transparent;
        padding: 1rem;
        border-radius: 4px;
    }
    
    /* Tabs 标签页 */
    .stTabs [data-baseweb="tab-list"] {
        background-color: #2d3139;
        border-radius: 8px;
    }
    
    .stTabs [data-baseweb="tab"] {
        color: #b0b3b8 !important;
        background-color: transparent;
    }
    
    .stTabs [aria-selected="true"] {
        color: #ffffff !important;
        background-color: #1f77b4;
        border-radius: 6px;
    }
    
    /* 表格样式 */
    .dataframe {
        background-color: #2d3139 !important;
        color: #e8eaed !important;
    }
    
    .dataframe th {
        background-color: #353a44 !important;
        color: #ffffff !important;
    }
    
    .dataframe td {
        background-color: #2d3139 !important;
        color: #e8eaed !important;
        border-color: #3a3f4b !important;
    }
    
    /* Spinner 加载动画 */
    .stSpinner > div {
        border-top-color: #1f77b4 !important;
    }
    
    /* 下载按钮 */
    .stDownloadButton > button {
        background-color: #2d3139;
        color: #e8eaed !important;
        border: 1px solid #3a3f4b;
    }
    
    .stDownloadButton > button:hover {
        background-color: #1f77b4;
        color: #ffffff !important;
        border-color: #1f77b4;
    }
</style>
""", unsafe_allow_html=True)


# ==================== 初始化 ====================

@st.cache_resource
def get_db():
    """获取数据库连接（缓存）"""
    init_database()
    return get_db_session()


@st.cache_data(ttl=300)
def load_papers(date_filter=None, direction=None, recommendation=None, limit=1000):
    """加载论文数据（缓存5分钟）"""
    db = get_db()
    query = PaperQueryEngine(db)
    
    if date_filter:
        papers = query.repo.get_by_date(date_filter, limit=limit)
    elif direction:
        # 将方向字符串转换为ResearchDirection枚举
        if isinstance(direction, str):
            try:
                direction = ResearchDirection[direction.upper()]
            except KeyError:
                direction = ResearchDirection.RAG  # 默认值
        papers = query.get_by_direction(direction, limit=limit)
    elif recommendation:
        papers = query.repo.get_papers_by_recommendation(recommendation, limit=limit)
    else:
        # 获取所有论文（不限制推荐等级）
        from sqlalchemy import desc
        from src.database.models import PaperDB
        papers = db.query(PaperDB).order_by(desc(PaperDB.published)).limit(limit).all()
    
    return [p.to_dict() for p in papers]


# ==================== 侧边栏 ====================

def render_sidebar():
    """渲染侧边栏 - 优化设计"""
    with st.sidebar:
        # Logo和标题
        st.markdown("""
        <div style="text-align: center; padding: 1rem 0;">
            <h1 style="color: #3498db; margin: 0;">📚</h1>
            <h3 style="margin: 0.5rem 0 0 0;">ArXiv AI Agent</h3>
            <p style="color: #7f8c8d; font-size: 0.9rem; margin: 0.3rem 0;">智能论文追踪系统</p>
        </div>
        """, unsafe_allow_html=True)
        
        st.divider()
        
        # 导航菜单
        st.markdown("### 🧭 导航")
        page = st.radio(
            "选择页面",
            ["🏠 首页", "🔍 论文搜索", "📊 研究方向", "🔥 热点趋势", "📈 统计分析"],
            label_visibility="collapsed"
        )
        
        st.divider()
        
        # 快捷筛选（仅在首页显示时有用）
        st.markdown("### ⚡ 快捷操作")
        
        # 刷新按钮
        if st.button("🔄 刷新数据", use_container_width=True):
            st.cache_data.clear()
            st.rerun()
        
        st.divider()
        
        # 统计信息
        st.markdown("### 📊 数据统计")
        try:
            papers = load_papers(limit=10000)
            if papers:
                st.metric("论文总数", f"{len(papers):,}")
                
                # 推荐分布
                rec_counts = Counter([p.get("recommendation") for p in papers])
                st.markdown("**推荐分布:**")
                for rec, count in [
                    ("🔥 极度推荐", rec_counts.get("极度推荐", 0)),
                    ("⭐ 很推荐", rec_counts.get("很推荐", 0)),
                    ("✓ 推荐", rec_counts.get("推荐", 0)),
                ]:
                    if count > 0:
                        st.text(f"{rec}: {count}")
        except Exception:
            st.text("数据加载中...")
        
        st.divider()
        
        # 关于信息
        st.markdown("### ℹ️ 关于")
        st.markdown("""
        **ArXiv AI Agent** 是一个智能论文追踪与分析系统。
        
        **主要功能:**
        - 🤖 自动抓取 ArXiv 论文
        - 🧠 AI 多维度评分
        - 📊 数据可视化分析
        - 🔍 智能搜索与推荐
        
        **技术栈:**
        - Python + Streamlit
        - SQLAlchemy + SQLite
        - OpenAI API
        - Plotly 图表
        
        ---
        Made with ❤️ by AI
        """)
        
        return page


# ==================== 页面内容 ====================

def render_home():
    """首页 - 优化设计"""
    # 标题
    st.markdown("# 📚 ArXiv AI Agent")
    st.markdown("### 智能论文追踪与分析系统")
    
    # 加载数据
    papers = load_papers(limit=1000)
    
    if not papers:
        st.warning("⚠️ 暂无数据，请先运行抓取任务")
        st.info("💡 使用命令: `python arxiv_daily_v3.py` 或 `./run.sh` 来抓取最新论文")
        return
    
    # 关键指标卡片
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric(
            label="📄 论文总数", 
            value=f"{len(papers):,}",
            help="数据库中的论文总数"
        )
    
    with col2:
        high_rec = len([p for p in papers if p.get("recommendation") == "极度推荐"])
        st.metric(
            label="🔥 极度推荐", 
            value=high_rec,
            delta=f"{(high_rec/len(papers)*100):.1f}%" if papers else "0%",
            help="极度推荐的论文数量及占比"
        )
    
    with col3:
        # 统计最热门方向
        all_keywords = []
        for p in papers:
            all_keywords.extend(p.get("keywords", []))
        if all_keywords:
            top_direction = Counter(all_keywords).most_common(1)[0]
            st.metric(
                label="📌 热门方向", 
                value=top_direction[0],
                delta=f"{top_direction[1]} 篇",
                help="当前最热门的研究方向"
            )
        else:
            st.metric(label="📌 热门方向", value="N/A")
    
    with col4:
        # 今日新增
        today = datetime.now().strftime("%Y-%m-%d")
        today_count = len([p for p in papers if p.get("published") == today])
        st.metric(
            label="📅 今日新增", 
            value=today_count,
            help="今天新增的论文数量"
        )
    
    st.divider()
    
    # 快速筛选器
    st.markdown("## 🎯 快速筛选")
    col1, col2, col3 = st.columns(3)
    with col1:
        filter_rec = st.selectbox(
            "推荐等级", 
            ["全部", "极度推荐", "很推荐", "推荐", "一般推荐"],
            key="home_filter_rec"
        )
    with col2:
        filter_date = st.selectbox(
            "时间范围",
            ["全部", "今天", "最近3天", "最近7天"],
            key="home_filter_date"
        )
    with col3:
        # 获取所有方向
        all_topics = list(set([p.get("sub_topic", "未知") for p in papers]))
        filter_topic = st.selectbox(
            "研究方向",
            ["全部"] + sorted(all_topics),
            key="home_filter_topic"
        )
    
    # 应用筛选
    filtered_papers = papers.copy()
    if filter_rec != "全部":
        filtered_papers = [p for p in filtered_papers if p.get("recommendation") == filter_rec]
    if filter_date == "今天":
        today = datetime.now().strftime("%Y-%m-%d")
        filtered_papers = [p for p in filtered_papers if p.get("published") == today]
    elif filter_date == "最近3天":
        cutoff = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
        filtered_papers = [p for p in filtered_papers if p.get("published", "") >= cutoff]
    elif filter_date == "最近7天":
        cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        filtered_papers = [p for p in filtered_papers if p.get("published", "") >= cutoff]
    if filter_topic != "全部":
        filtered_papers = [p for p in filtered_papers if p.get("sub_topic") == filter_topic]
    
    st.markdown(f"#### 找到 {len(filtered_papers)} 篇论文")
    
    st.divider()
    
    # 论文列表
    st.markdown("## 🔥 推荐论文")
    
    if not filtered_papers:
        st.info("没有符合条件的论文")
        return
    
    # 限制显示数量
    display_count = min(len(filtered_papers), 20)
    if len(filtered_papers) > 20:
        st.info(f"显示前 {display_count} 篇论文（共 {len(filtered_papers)} 篇）")
    
    for paper in filtered_papers[:display_count]:
        render_paper_card(paper)


def render_paper_card(paper):
    """渲染论文卡片 - 现代化设计"""
    # 推荐等级徽章样式
    rec_badge = {
        "极度推荐": "🔥",
        "很推荐": "⭐",
        "推荐": "✓",
        "一般推荐": "·",
        "不推荐": "○"
    }.get(paper.get("recommendation"), "·")
    
    # 推荐等级颜色
    rec_color = {
        "极度推荐": "#ff4b4b",
        "很推荐": "#ff7f0e",
        "推荐": "#2ca02c",
        "一般推荐": "#9467bd",
        "不推荐": "#7f7f7f"
    }.get(paper.get("recommendation"), "#7f7f7f")
    
    # 转义 HTML 特殊字符以防止 XSS
    title = html.escape(paper.get("title", "无标题"))
    authors = [html.escape(a) for a in paper.get("authors", [])[:3]]
    published = html.escape(str(paper.get("published", "N/A")))
    keywords = [html.escape(k) for k in paper.get("keywords", [])[:5]]
    sub_topic = html.escape(paper.get("sub_topic", "未知"))
    recommendation = html.escape(paper.get("recommendation", "一般推荐"))
    
    # 创建卡片容器
    with st.container():
        # 顶部：标题和推荐标签
        col_title, col_badge = st.columns([4, 1])
        with col_title:
            st.markdown(f"### {title}")
        with col_badge:
            st.markdown(
                f'<div style="text-align: right; padding-top: 0.5rem;">'
                f'<span style="background-color: {rec_color}; color: white; padding: 0.3rem 0.8rem; '
                f'border-radius: 12px; font-size: 0.85rem; font-weight: 600;">'
                f'{rec_badge} {recommendation}</span></div>',
                unsafe_allow_html=True
            )
        
        # 作者信息
        author_text = ', '.join(authors)
        if len(paper.get('authors', [])) > 3:
            author_text += ' et al.'
        st.markdown(f"**👥 作者:** {author_text}")
        
        # 信息行：日期、方向、关键词
        col1, col2 = st.columns(2)
        with col1:
            st.markdown(f"**📅 发布:** {published}")
            st.markdown(f"**📊 方向:** {sub_topic}")
        with col2:
            if keywords:
                keyword_tags = ' '.join([f'`{k}`' for k in keywords[:3]])
                st.markdown(f"**🏷️ 关键词:** {keyword_tags}")
        
        # 展开查看详情
        with st.expander("📖 查看详细信息"):
            # 显示主图（如果有）
            image_url = paper.get('primary_image_url')
            if image_url:
                try:
                    st.image(image_url, caption="论文主图", use_container_width=True)
                except Exception:
                    pass
            
            # 获取摘要（优先中文摘要，否则英文摘要）
            trans_abs = paper.get('trans_abs', '')
            abstract = paper.get('abstract', '')
            display_abs = trans_abs if trans_abs and len(trans_abs) > 10 else abstract
            
            if display_abs:
                st.markdown("#### 📝 摘要")
                # 直接显示摘要文本，不使用引用块格式
                st.markdown(display_abs)
            else:
                st.info("暂无摘要信息")
            
            # 链接按钮
            st.markdown("#### 🔗 相关链接")
            col1, col2, col3 = st.columns(3)
            with col1:
                if paper.get("abs_url"):
                    st.link_button("📄 ArXiv 页面", paper.get("abs_url"), use_container_width=True)
            with col2:
                if paper.get("pdf_url"):
                    st.link_button("📥 PDF 下载", paper.get("pdf_url"), use_container_width=True)
            with col3:
                if paper.get("doi_url"):
                    st.link_button("🔗 DOI", paper.get("doi_url"), use_container_width=True)
        
        # 分隔线
        st.divider()


def render_search():
    """搜索页面 - 优化设计"""
    st.markdown("# 🔍 论文搜索")
    st.markdown("### 通过关键词、日期等条件搜索论文")
    
    # 搜索框
    st.markdown("#### 搜索条件")
    search_query = st.text_input(
        "输入关键词",
        placeholder="例如: transformer, LLM, computer vision（多个关键词用逗号分隔）",
        help="支持多个关键词搜索，用逗号分隔"
    )
    
    col1, col2, col3 = st.columns(3)
    with col1:
        date_from = st.date_input(
            "起始日期", 
            datetime.now() - timedelta(days=30),
            help="选择搜索的起始日期"
        )
    with col2:
        date_to = st.date_input(
            "结束日期", 
            datetime.now(),
            help="选择搜索的结束日期"
        )
    with col3:
        limit = st.slider(
            "结果数量", 
            10, 200, 50,
            help="限制返回的论文数量"
        )
    
    # 搜索按钮
    col_btn1, col_btn2, col_btn3 = st.columns([1, 1, 4])
    with col_btn1:
        search_btn = st.button("🔍 搜索", type="primary", use_container_width=True)
    with col_btn2:
        clear_btn = st.button("🔄 清空", use_container_width=True)
    
    if clear_btn:
        st.rerun()
    
    if search_btn:
        if not search_query.strip():
            st.warning("⚠️ 请输入搜索关键词")
            return
            
        with st.spinner("🔍 正在搜索..."):
            db = get_db()
            query = PaperQueryEngine(db)
            
            criteria = SearchCriteria(
                keywords=[k.strip() for k in search_query.split(",") if k.strip()],
                date_from=date_from.strftime("%Y-%m-%d"),
                date_to=date_to.strftime("%Y-%m-%d")
            )
            
            results = query.search(criteria, limit=limit)
            
            st.divider()
            
            if results:
                st.success(f"✅ 找到 {len(results)} 篇相关论文")
                
                # 统计信息
                col1, col2, col3 = st.columns(3)
                with col1:
                    high_rec = len([p for p in results if p.get("recommendation") == "极度推荐"])
                    st.metric("🔥 极度推荐", high_rec)
                with col2:
                    very_rec = len([p for p in results if p.get("recommendation") == "很推荐"])
                    st.metric("⭐ 很推荐", very_rec)
                with col3:
                    rec = len([p for p in results if p.get("recommendation") == "推荐"])
                    st.metric("✓ 推荐", rec)
                
                st.divider()
                st.markdown("## 📄 搜索结果")
                
                for paper in results:
                    render_paper_card(paper)
            else:
                st.info("😔 没有找到相关论文，请尝试其他关键词")


def render_directions():
    """研究方向页面"""
    st.markdown("# 📊 研究方向分析")
    st.markdown("### 探索不同研究方向的论文分布")
    
    db = get_db()
    analyzer = TrendAnalyzer(db)
    
    # 热门方向统计
    st.markdown("## 🔥 热门研究方向（最近7天）")
    
    hot_directions = analyzer.get_hot_directions(days=7, top_n=8)
    
    if hot_directions:
        # 创建图表
        fig = go.Figure(data=[
            go.Bar(
                x=[d["name"] for d in hot_directions],
                y=[d["count"] for d in hot_directions],
                marker_color=['#ff4b4b' if d["count"] > 10 else '#1f77b4' for d in hot_directions]
            )
        ])
        fig.update_layout(
            title="各方向论文数量",
            xaxis_title="研究方向",
            yaxis_title="论文数量",
            showlegend=False,
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font=dict(color='#e8eaed')
        )
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("暂无热门方向数据")
    
    st.divider()
    
    # 方向详情
    st.markdown("## 📚 按方向浏览论文")
    st.info("💡 点击上方标签切换不同研究方向")
    
    # 使用session_state来跟踪当前选中的方向
    if 'selected_direction' not in st.session_state:
        st.session_state.selected_direction = ResearchDirection.RAG
    
    # 创建方向选择器
    direction_names = {d.value: d for d in ResearchDirection}
    selected_name = st.selectbox(
        "选择研究方向",
        options=list(direction_names.keys()),
        format_func=lambda x: f"{x} ({direction_names[x].name})",
        key="direction_selector"
    )
    
    selected_direction = direction_names[selected_name]
    st.session_state.selected_direction = selected_direction
    
    # 直接使用查询引擎获取数据（不通过缓存）
    with st.spinner(f"正在加载 {selected_direction.value} 方向的论文..."):
        try:
            # 获取数据库连接
            db = get_db()
            
            # 方法1: 使用ORM直接查询（最可靠）
            from src.database.models import PaperDB
            from sqlalchemy import desc
            
            papers_orm = db.query(PaperDB).filter(
                PaperDB.sub_topic == selected_direction.value
            ).order_by(desc(PaperDB.published)).limit(50).all()
            
            # 转换为字典列表
            papers = [p.to_dict() for p in papers_orm]
            
            if papers and len(papers) > 0:
                st.success(f"✅ 共找到 **{len(papers)}** 篇 **{selected_direction.value}** 方向的论文")
                
                # 显示前20篇
                display_count = min(len(papers), 20)
                if len(papers) > 20:
                    st.info(f"显示前 {display_count} 篇（共 {len(papers)} 篇）")
                
                for paper in papers[:display_count]:
                    render_paper_card(paper)
            else:
                st.warning(f"⚠️ 暂无 **{selected_direction.value}** 方向的论文数据")
                st.info(f"💡 当前数据库中有以下方向的论文：")
                # 显示所有可用的方向
                all_topics = db.query(PaperDB.sub_topic).distinct().all()
                available = [t[0] for t in all_topics if t[0] and t[0] != "未知"]
                st.write(f"可用方向: {', '.join(available)}")
        except Exception as e:
            st.error(f"❌ 查询出错: {str(e)}")
            import traceback
            st.code(traceback.format_exc())
            st.info("💡 请检查数据库连接或刷新页面重试")


def render_trends():
    """热点趋势页面"""
    st.markdown('<div class="main-header">🔥 技术热点趋势</div>', unsafe_allow_html=True)
    
    db = get_db()
    analyzer = TrendAnalyzer(db)
    
    # 趋势时间范围
    days = st.slider("时间范围（天）", 7, 90, 30)
    
    # 选择要查看的方向趋势
    selected_directions = st.multiselect(
        "选择研究方向",
        [d.name for d in ResearchDirection],
        default=[ResearchDirection.MOE.name, ResearchDirection.LORA.name]
    )
    
    if selected_directions:
        fig = go.Figure()
        
        for dir_name in selected_directions:
            direction = ResearchDirection[dir_name]
            trend = analyzer.get_direction_trend(direction, days=days)
            
            if trend:
                dates = [t.date for t in trend]
                counts = [t.count for t in trend]
                
                fig.add_trace(go.Scatter(
                    x=dates,
                    y=counts,
                    mode='lines+markers',
                    name=dir_name
                ))
        
        fig.update_layout(
            title="研究方向热度趋势",
            xaxis_title="日期",
            yaxis_title="论文数量",
            hovermode='x unified'
        )
        st.plotly_chart(fig, use_container_width=True)
    
    # 新兴关键词
    st.markdown('<div class="sub-header">✨ 新兴关键词</div>', unsafe_allow_html=True)
    
    emerging = analyzer.get_emerging_keywords(days=14, limit=20)
    
    if emerging:
        # 词云效果（用条形图模拟）
        fig = px.bar(
            x=[k["keyword"] for k in emerging],
            y=[k["count"] for k in emerging],
            labels={"x": "关键词", "y": "出现次数"},
            title="最近14天热门关键词"
        )
        st.plotly_chart(fig, use_container_width=True)


def render_stats():
    """统计分析页面"""
    st.markdown('<div class="main-header">📈 统计分析</div>', unsafe_allow_html=True)
    
    papers = load_papers(limit=5000)
    
    if not papers:
        st.warning("暂无数据")
        return
    
    # 转换为 DataFrame
    df = pd.DataFrame(papers)
    
    # 推荐等级分布
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("### 推荐等级分布")
        rec_counts = df["recommendation"].value_counts()
        fig = px.pie(
            values=rec_counts.values,
            names=rec_counts.index,
            title="推荐等级占比"
        )
        st.plotly_chart(fig, use_container_width=True)
    
    with col2:
        st.markdown("### 子主题分布（Top 10）")
        subtopic_counts = df["sub_topic"].value_counts().head(10)
        fig = px.bar(
            x=subtopic_counts.index,
            y=subtopic_counts.values,
            title="子主题论文数量"
        )
        st.plotly_chart(fig, use_container_width=True)
    
    # 时间趋势
    st.markdown("### 📅 论文发布时间趋势")
    df["published"] = pd.to_datetime(df["published"])
    daily_counts = df.groupby(df["published"].dt.date).size().reset_index()
    daily_counts.columns = ["date", "count"]
    
    fig = px.line(
        daily_counts,
        x="date",
        y="count",
        title="每日论文数量趋势"
    )
    st.plotly_chart(fig, use_container_width=True)
    
    # 数据导出
    st.markdown("### 💾 数据导出")
    csv = df.to_csv(index=False).encode('utf-8')
    st.download_button(
        "📥 下载 CSV",
        csv,
        "arxiv_papers.csv",
        "text/csv"
    )


# ==================== 主程序 ====================

def main():
    """主函数"""
    page = render_sidebar()
    
    if page == "🏠 首页":
        render_home()
    elif page == "🔍 论文搜索":
        render_search()
    elif page == "📊 研究方向":
        render_directions()
    elif page == "🔥 热点趋势":
        render_trends()
    elif page == "📈 统计分析":
        render_stats()


if __name__ == "__main__":
    main()
