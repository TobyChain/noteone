"""
查询接口 - 支持多维度检索和热点追踪
"""

from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from dataclasses import dataclass
from sqlalchemy import func, desc, and_, or_
from sqlalchemy.orm import Session
from loguru import logger

from src.database.connection import get_db_session
from src.database.models import PaperDB, DailyReportDB
from src.database.repositories import PaperRepository
from src.core.scoring import ResearchDirection


@dataclass
class SearchCriteria:
    """搜索条件"""
    keywords: Optional[List[str]] = None          # 关键词（标题/摘要）
    directions: Optional[List[str]] = None        # 研究方向
    recommendation: Optional[str] = None          # 推荐等级
    authors: Optional[List[str]] = None           # 作者
    date_from: Optional[str] = None               # 起始日期
    date_to: Optional[str] = None                 # 结束日期
    sub_topic: Optional[str] = None               # 子主题
    min_score: Optional[float] = None             # 最低综合得分


@dataclass
class TrendPoint:
    """趋势数据点"""
    date: str
    count: int
    avg_score: float
    top_papers: List[Dict]


class PaperQueryEngine:
    """论文查询引擎"""
    
    def __init__(self, db: Optional[Session] = None):
        self.db = db or get_db_session()
        self.repo = PaperRepository(self.db)
    
    def search(self, criteria: SearchCriteria, limit: int = 100) -> List[Dict]:
        """
        多条件搜索论文
        
        Args:
            criteria: 搜索条件
            limit: 返回数量限制
            
        Returns:
            论文列表
        """
        query = self.db.query(PaperDB)
        
        # 关键词搜索（标题或摘要）
        if criteria.keywords:
            keyword_filters = []
            for kw in criteria.keywords:
                pattern = f"%{kw}%"
                keyword_filters.append(
                    or_(
                        PaperDB.title.ilike(pattern),
                        PaperDB.trans_abs.ilike(pattern),
                        PaperDB.keywords.contains([kw])
                    )
                )
            query = query.filter(or_(*keyword_filters))
        
        # 研究方向搜索（通过 sub_topic 字段）
        if criteria.directions:
            direction_filters = []
            for direction in criteria.directions:
                # 使用 sub_topic 字段而不是 keywords
                direction_filters.append(PaperDB.sub_topic == direction)
            query = query.filter(or_(*direction_filters))
        
        # 推荐等级
        if criteria.recommendation:
            query = query.filter(PaperDB.recommendation == criteria.recommendation)
        
        # 作者搜索
        if criteria.authors:
            author_filters = []
            for author in criteria.authors:
                author_filters.append(PaperDB.authors.contains([author]))
            query = query.filter(or_(*author_filters))
        
        # 日期范围
        if criteria.date_from:
            query = query.filter(PaperDB.published >= criteria.date_from)
        if criteria.date_to:
            query = query.filter(PaperDB.published <= criteria.date_to)
        
        # 子主题
        if criteria.sub_topic:
            query = query.filter(PaperDB.sub_topic == criteria.sub_topic)
        
        # 最低得分（假设存储在 keywords 或扩展字段中）
        # 这里简化处理，实际应该添加 score 字段
        
        from src.core.scoring import RECOMMENDATION_ORDER

        results = query.order_by(
            desc(PaperDB.published),
        ).limit(limit).all()

        papers = [r.to_dict() for r in results]
        papers.sort(key=lambda x: RECOMMENDATION_ORDER.get(x.get("recommendation"), 0), reverse=True)
        
        return papers
    
    def get_by_direction(
        self,
        direction: ResearchDirection,
        date: Optional[str] = None,
        min_score: float = 30.0,
        limit: int = 50
    ) -> List[Dict]:
        """
        按研究方向获取论文
        
        Args:
            direction: 研究方向
            date: 特定日期，None 则获取全部
            min_score: 最低相关性得分
            limit: 数量限制
        """
        criteria = SearchCriteria(
            directions=[direction.value],
            date_from=date,
            date_to=date
        )
        return self.search(criteria, limit)
    
    def get_hot_papers(self, days: int = 7, limit: int = 20) -> List[Dict]:
        """
        获取近期热点论文
        
        Args:
            days: 最近 N 天
            limit: 数量限制
        """
        date_to = datetime.now().strftime("%Y-%m-%d")
        date_from = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        
        criteria = SearchCriteria(
            date_from=date_from,
            date_to=date_to,
            recommendation="极度推荐"  # 只关注极度推荐
        )
        
        return self.search(criteria, limit)
    
    def get_daily_summary(self, date: str) -> Dict[str, Any]:
        """
        获取某日论文汇总
        
        Args:
            date: 日期 (YYYY-MM-DD)
            
        Returns:
            汇总统计
        """
        # 获取该日论文
        papers = self.repo.get_by_date(date)
        
        if not papers:
            return {
                "date": date,
                "total": 0,
                "message": "该日期无数据"
            }
        
        # 统计
        by_recommendation = {}
        by_subtopic = {}
        by_direction = {}
        
        for p in papers:
            # 推荐等级
            rec = p.recommendation
            by_recommendation[rec] = by_recommendation.get(rec, 0) + 1
            
            # 子主题
            st = p.sub_topic
            by_subtopic[st] = by_subtopic.get(st, 0) + 1
            
            # 研究方向（通过关键词推断）
            for kw in (p.keywords or []):
                if kw in [d.value for d in ResearchDirection]:
                    by_direction[kw] = by_direction.get(kw, 0) + 1
        
        # 获取高分论文
        top_papers = [
            p.to_dict() for p in papers
            if p.recommendation in ["极度推荐", "很推荐"]
        ][:10]
        
        return {
            "date": date,
            "total": len(papers),
            "by_recommendation": by_recommendation,
            "by_subtopic": dict(sorted(by_subtopic.items(), key=lambda x: -x[1])[:10]),
            "by_direction": by_direction,
            "top_papers": top_papers
        }
    


class TrendAnalyzer:
    """技术趋势分析器"""
    
    def __init__(self, db: Optional[Session] = None):
        self.db = db or get_db_session()
    
    def get_direction_trend(
        self,
        direction: ResearchDirection,
        days: int = 30
    ) -> List[TrendPoint]:
        """
        获取某研究方向的趋势
        
        Args:
            direction: 研究方向
            days: 统计天数
            
        Returns:
            趋势数据点列表
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        
        # 按日期分组统计
        results = (
            self.db.query(
                PaperDB.published,
                func.count(PaperDB.id).label('count'),
                func.avg(0).label('avg_score')  # 简化处理
            )
            .filter(
                PaperDB.published >= start_date.strftime("%Y-%m-%d"),
                PaperDB.keywords.contains([direction.value])
            )
            .group_by(PaperDB.published)
            .order_by(PaperDB.published)
            .all()
        )
        
        trend = []
        for date_str, count, avg_score in results:
            # 获取该日该方向的高分论文
            papers = (
                self.db.query(PaperDB)
                .filter(
                    PaperDB.published == date_str,
                    PaperDB.keywords.contains([direction.value])
                )
                .order_by(desc(PaperDB.recommendation))
                .limit(3)
                .all()
            )
            
            trend.append(TrendPoint(
                date=date_str,
                count=count,
                avg_score=float(avg_score or 0),
                top_papers=[p.to_dict() for p in papers]
            ))
        
        return trend
    
    def get_hot_directions(self, days: int = 7, top_n: int = 5) -> List[Dict]:
        """
        获取近期热门研究方向
        
        Args:
            days: 最近 N 天
            top_n: 返回前 N 个
        """
        date_from = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        
        # 统计各方向论文数量
        direction_counts = {}
        
        for direction in ResearchDirection:
            count = (
                self.db.query(PaperDB)
                .filter(
                    PaperDB.published >= date_from,
                    PaperDB.keywords.contains([direction.value])
                )
                .count()
            )
            direction_counts[direction] = count
        
        # 排序取前 N
        sorted_directions = sorted(
            direction_counts.items(),
            key=lambda x: -x[1]
        )[:top_n]
        
        return [
            {
                "direction": d.value,
                "name": d.name,
                "count": c,
                "trend": "up" if c > 5 else "stable"  # 简化趋势判断
            }
            for d, c in sorted_directions if c > 0
        ]
    
    def get_emerging_keywords(self, days: int = 14, limit: int = 20) -> List[Dict]:
        """
        发现新兴关键词
        
        Args:
            days: 统计天数
            limit: 返回数量
            
        Returns:
            关键词列表及频次
        """
        date_from = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        
        # 获取近期所有关键词
        papers = (
            self.db.query(PaperDB)
            .filter(PaperDB.published >= date_from)
            .all()
        )
        
        # 统计关键词频次
        keyword_counts = {}
        for p in papers:
            for kw in (p.keywords or []):
                keyword_counts[kw] = keyword_counts.get(kw, 0) + 1
        
        # 排序返回
        sorted_keywords = sorted(
            keyword_counts.items(),
            key=lambda x: -x[1]
        )[:limit]
        
        return [
            {"keyword": kw, "count": count}
            for kw, count in sorted_keywords
        ]
    
    def generate_weekly_report(self, end_date: Optional[str] = None) -> Dict[str, Any]:
        """生成周报"""
        if end_date:
            from datetime import datetime as _dt
            end_dt = _dt.strptime(end_date.replace("-", ""), "%Y%m%d")
        else:
            end_dt = datetime.now()
        start_dt = end_dt - timedelta(days=7)
        
        query_engine = PaperQueryEngine(self.db)
        
        # 总体统计
        total_papers = (
            self.db.query(PaperDB)
            .filter(PaperDB.published >= start_dt.strftime("%Y-%m-%d"))
            .count()
        )
        
        # 热门方向
        hot_directions = self.get_hot_directions(days=7, top_n=5)
        
        # 高分论文
        top_papers = query_engine.get_hot_papers(days=7, limit=10)
        
        # 新兴关键词
        emerging = self.get_emerging_keywords(days=7, limit=10)
        
        return {
            "period": f"{start_dt.strftime('%Y-%m-%d')} ~ {end_dt.strftime('%Y-%m-%d')}",
            "total_papers": total_papers,
            "hot_directions": hot_directions,
            "top_papers": top_papers,
            "emerging_keywords": emerging
        }


# ==================== CLI 接口 ====================

def main():
    """查询 CLI"""
    import argparse
    import json
    
    parser = argparse.ArgumentParser(description="论文查询工具")
    parser.add_argument("--search", "-s", help="搜索关键词")
    parser.add_argument("--direction", "-d", help="研究方向")
    parser.add_argument("--date", help="特定日期")
    parser.add_argument("--days", type=int, default=7, help="最近 N 天")
    parser.add_argument("--recommendation", "-r", help="推荐等级")
    parser.add_argument("--hot", action="store_true", help="显示热点论文")
    parser.add_argument("--trend", help="显示某方向趋势")
    parser.add_argument("--weekly", action="store_true", help="生成周报")
    parser.add_argument("--limit", "-l", type=int, default=20, help="数量限制")
    parser.add_argument("--json", "-j", action="store_true", help="JSON 输出")
    
    args = parser.parse_args()
    
    query = PaperQueryEngine()
    analyzer = TrendAnalyzer()
    
    # 执行查询
    if args.search:
        criteria = SearchCriteria(keywords=args.search.split(","))
        results = query.search(criteria, args.limit)
        print(f"\n🔍 搜索 '{args.search}' 的结果 ({len(results)} 篇):\n")
        for p in results[:10]:
            print(f"  [{p['recommendation']}] {p['title'][:80]}...")
    
    elif args.direction:
        direction = ResearchDirection(args.direction)
        results = query.get_by_direction(direction, args.date, limit=args.limit)
        print(f"\n📊 {direction.name} 方向 ({len(results)} 篇):\n")
        for p in results[:10]:
            print(f"  [{p['recommendation']}] {p['title'][:80]}...")
    
    elif args.hot:
        results = query.get_hot_papers(args.days, args.limit)
        print(f"\n🔥 最近 {args.days} 天热点论文 ({len(results)} 篇):\n")
        for p in results:
            print(f"  [{p['recommendation']}] {p['title'][:80]}...")
    
    elif args.trend:
        direction = ResearchDirection(args.trend)
        trend = analyzer.get_direction_trend(direction, args.days)
        print(f"\n📈 {direction.name} 趋势 (最近 {args.days} 天):\n")
        for point in trend:
            print(f"  {point.date}: {point.count} 篇")
    
    elif args.weekly:
        report = analyzer.generate_weekly_report()
        if args.json:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            print(f"\n📅 周报: {report['period']}\n")
            print(f"总论文数: {report['total_papers']}")
            print("\n热门方向:")
            for d in report['hot_directions']:
                print(f"  - {d['name']}: {d['count']} 篇")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
