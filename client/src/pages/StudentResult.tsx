import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Space, Spin, Statistic, Tag, Typography, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { AnswerContent, StudentAttemptResult } from '@exam-maker/shared';
import { getStudentResult } from '../services/exam';
import { questionTypeLabels } from '../utils/examLabels';

const { Title, Text, Paragraph } = Typography;

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

function displayAnswer(value: AnswerContent | null): string {
  if (value === null) return '未作答';
  if (typeof value === 'string') return value || '未作答';
  return JSON.stringify(value, null, 2);
}

const StudentResult: React.FC = () => {
  const { id } = useParams();
  const attemptId = Number(id);
  const navigate = useNavigate();
  const [result, setResult] = useState<StudentAttemptResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStudentResult(attemptId).then(setResult).catch((error) => {
      message.error(errorMessage(error, '加载成绩失败'));
      navigate('/student/exams', { replace: true });
    }).finally(() => setLoading(false));
  }, [attemptId, navigate]);

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!result) return null;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/student/exams')} style={{ marginBottom: 16 }}>返回我的考试</Button>
      {result.exam.gradeReviewEnabled && <Button style={{ marginLeft: 8, marginBottom: 16 }} onClick={() => navigate(`/student/grade-reviews?attemptId=${result.attempt.id}`)}>申请成绩复核</Button>}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <Title level={3} style={{ marginBottom: 4 }}>{result.exam.title}</Title>
            <Text type="secondary">{result.paper.title} · 第 {result.attempt.attemptNo} 次作答</Text>
          </div>
          <Space size={28}>
            <Statistic title="客观题" value={result.attempt.objectiveScore} suffix="分" />
            <Statistic title="主观题" value={result.attempt.subjectiveScore} suffix="分" />
            <Statistic title="当前总分" value={result.attempt.totalScore} suffix={`/ ${result.paper.totalScore}`} />
          </Space>
        </div>
      </Card>
      {result.attempt.status === 'grading'
        ? <Alert type="warning" showIcon message="客观题已完成自动判分，主观题正在等待教师批改，当前总分不是最终成绩。" style={{ marginBottom: 16 }} />
        : <Alert type="success" showIcon message="试卷已完成批改，当前显示最终成绩。" style={{ marginBottom: 16 }} />}
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {result.questions.map((question) => (
          <Card
            key={question.paperQuestionId}
            title={`${question.orderNo}. ${questionTypeLabels[question.type]}`}
            extra={<Space><Tag>{question.score} 分</Tag><Tag color={question.answer.gradingStatus === 'ungraded' ? 'warning' : 'blue'}>{question.answer.gradingStatus === 'ungraded' ? '待批改' : `得 ${question.answer.finalScore ?? 0} 分`}</Tag></Space>}
          >
            <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 16 }}>{question.stem}</Paragraph>
            <Text strong>我的答案</Text>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{displayAnswer(question.answer.content)}</pre>
            {question.answer.feedback && <Alert type="info" showIcon message={`教师评语：${question.answer.feedback}`} style={{ marginBottom: 12 }} />}
            {'answerKey' in question && (
              <Card size="small" type="inner" title="标准答案" style={{ marginTop: 12 }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(question.answerKey, null, 2) || '未设置'}</pre>
              </Card>
            )}
            {'analysis' in question && question.analysis && (
              <Card size="small" type="inner" title="题目解析" style={{ marginTop: 12 }}>{question.analysis}</Card>
            )}
          </Card>
        ))}
      </Space>
    </div>
  );
};

export default StudentResult;
