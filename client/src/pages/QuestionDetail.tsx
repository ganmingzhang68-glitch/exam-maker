import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Descriptions, Empty, List, Space, Spin, Statistic, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined, EditOutlined } from '@ant-design/icons';
import type { QuestionDetail as Detail } from '@exam-maker/shared';
import { getQuestion } from '../services/question';
import { difficultyLabels, questionTypeLabels } from '../utils/examLabels';

const { Title, Paragraph, Text } = Typography;
const originLabels = { past_exam: '往年真题', ai_generated: 'AI 生成', teacher_created: '教师创建', imported: '导入' } as const;

const QuestionDetail: React.FC = () => {
  const id = Number(useParams().id); const navigate = useNavigate();
  const [question, setQuestion] = useState<Detail | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { getQuestion(id).then(setQuestion).catch(() => { message.error('加载题目详情失败'); navigate('/questions'); }).finally(() => setLoading(false)); }, [id, navigate]);
  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!question) return null;
  return <div style={{ maxWidth: 1000, margin: '0 auto' }}>
    <Space style={{ marginBottom: 16 }}><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/questions')}>返回题库</Button><Button type="primary" icon={<EditOutlined />} onClick={() => navigate(`/questions/${id}/edit`)}>编辑题目</Button></Space>
    <Card title={<Space><Title level={4} style={{ margin: 0 }}>题目 #{question.id}</Title><Tag>{questionTypeLabels[question.type]}</Tag><Tag color="blue">{question.lifecycleStatus}</Tag></Space>} style={{ marginBottom: 16 }}>
      <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 17 }}>{question.stem}</Paragraph>
      {question.options?.length ? <List size="small" bordered dataSource={question.options} renderItem={(item, index) => <List.Item>{String.fromCharCode(65 + index)}. {item}</List.Item>} /> : null}
    </Card>
    <Card title="答案、解析与评分" style={{ marginBottom: 16 }}><Descriptions bordered column={1} items={[
      { key: 'answer', label: '标准答案', children: <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(question.answerKey, null, 2) || '未设置'}</pre> },
      { key: 'analysis', label: '解析', children: question.analysis || '未设置' },
      { key: 'rubric', label: 'Rubric', children: <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(question.scoringRubric, null, 2) || '未设置'}</pre> },
    ]} /></Card>
    <Card title="题目属性" style={{ marginBottom: 16 }}><Descriptions bordered column={2} items={[
      { key: 'score', label: '分值', children: `${question.defaultScore} 分` }, { key: 'difficulty', label: '难度', children: question.difficulty ? difficultyLabels[question.difficulty] : '未设置' },
      { key: 'kp', label: '考点', children: question.knowledgePoints?.join('、') || '未设置' }, { key: 'origin', label: '来源', children: originLabels[question.origin] },
      { key: 'course', label: '课程', children: question.courseName || '未关联' }, { key: 'source', label: '来源文件', children: question.sourceFileName || question.sourceProjectTitle || '无' },
    ]} /></Card>
    {question.statistics && <Card title="历史作答统计" style={{ marginBottom: 16 }}><Space size={48}><Statistic title="作答人数" value={question.statistics.responseCount} /><Statistic title="正确率" value={(question.statistics.correctRate ?? 0) * 100} precision={1} suffix="%" /><Statistic title="平均得分率" value={(question.statistics.averageScoreRate ?? 0) * 100} precision={1} suffix="%" /></Space></Card>}
    <Card title="被试卷使用" style={{ marginBottom: 16 }}>{question.usedByPapers.length ? <List dataSource={question.usedByPapers} renderItem={(paper) => <List.Item actions={[<Button key="paper" type="link" onClick={() => navigate(`/papers/${paper.id}`)}>查看试卷</Button>]}>{paper.title} <Tag>{paper.status}</Tag></List.Item>} /> : <Empty description="尚未加入试卷" />}</Card>
    <Card title="教师修改历史">{question.versions.length ? <List dataSource={question.versions} renderItem={(version) => <List.Item><Space direction="vertical"><Text strong>版本 {version.versionNo} · {version.changeNote || '修改'}</Text><Text type="secondary">{new Date(version.createdAt).toLocaleString('zh-CN')} · 操作人 #{version.changedBy}</Text></Space></List.Item>} /> : <Empty description="暂无修改历史" />}</Card>
  </div>;
};
export default QuestionDetail;
