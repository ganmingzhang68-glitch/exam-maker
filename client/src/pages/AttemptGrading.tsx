import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons';
import type { AnswerContent, TeacherAttemptGradingDetail } from '@exam-maker/shared';
import { getTeacherAttemptResult, gradeSubjectiveAnswer } from '../services/exam';
import { questionTypeLabels } from '../utils/examLabels';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

function displayAnswer(value: AnswerContent | null): string {
  if (value === null) return '未作答';
  if (typeof value === 'string') return value || '未作答';
  return JSON.stringify(value, null, 2);
}

const AttemptGrading: React.FC = () => {
  const { id, attemptId: attemptIdParam } = useParams();
  const examId = Number(id);
  const attemptId = Number(attemptIdParam);
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TeacherAttemptGradingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { score: number; feedback: string }>>({});

  const applyDetail = (data: TeacherAttemptGradingDetail) => {
    setDetail(data);
    setDrafts(Object.fromEntries(data.questions.filter((question) => question.subjective).map((question) => [
      question.answer.id,
      {
        score: question.answer.manualScore ?? 0,
        feedback: question.answer.feedback ?? '',
      },
    ])));
  };

  useEffect(() => {
    getTeacherAttemptResult(examId, attemptId).then(applyDetail).catch((error) => {
      message.error(errorMessage(error, '加载学生答卷失败'));
      navigate(`/exams/${examId}/results`, { replace: true });
    }).finally(() => setLoading(false));
  }, [attemptId, examId, navigate]);

  const saveGrade = async (answerId: number) => {
    const draft = drafts[answerId];
    if (!draft) return;
    setSavingId(answerId);
    try {
      const updated = await gradeSubjectiveAnswer(examId, attemptId, answerId, draft.score, draft.feedback);
      applyDetail(updated);
      message.success('批改结果和总分已重新计算');
    } catch (error) {
      message.error(errorMessage(error, '保存批改失败'));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!detail) return null;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/exams/${examId}/results`)} style={{ marginBottom: 16 }}>返回成绩列表</Button>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24 }}>
          <div>
            <Title level={4} style={{ marginBottom: 4 }}>{detail.exam.title}</Title>
            <Text>{detail.student.username} · 第 {detail.attempt.attemptNo} 次作答</Text>
            <br />
            <Tag color={detail.attempt.status === 'graded' ? 'success' : 'warning'} style={{ marginTop: 8 }}>
              {detail.attempt.status === 'graded' ? '已完成批改' : '待人工批改'}
            </Tag>
          </div>
          <Space size={28}>
            <Statistic title="客观题" value={detail.attempt.objectiveScore} suffix="分" />
            <Statistic title="主观题" value={detail.attempt.subjectiveScore} suffix="分" />
            <Statistic title="总分" value={detail.attempt.totalScore} suffix={`/ ${detail.paper.totalScore}`} />
          </Space>
        </div>
      </Card>
      {detail.attempt.status === 'grading' && <Alert type="warning" showIcon message="存在尚未人工批改的主观题。" style={{ marginBottom: 16 }} />}
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {detail.questions.map((question) => {
          const draft = drafts[question.answer.id];
          return (
            <Card
              key={question.paperQuestionId}
              title={`${question.orderNo}. ${questionTypeLabels[question.type]}`}
              extra={<Tag>{question.score} 分</Tag>}
            >
              <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 16 }}>{question.stem}</Paragraph>
              <Card size="small" type="inner" title="学生答案" style={{ marginBottom: 12 }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{displayAnswer(question.answer.content)}</pre>
              </Card>
              <Card size="small" type="inner" title="标准答案" style={{ marginBottom: 12 }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(question.answerKey, null, 2) || '未设置'}</pre>
                {question.analysis && <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>解析：{question.analysis}</Paragraph>}
              </Card>
              {question.subjective ? (
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 12, alignItems: 'end' }}>
                  <div>
                    <Text>得分</Text>
                    <InputNumber
                      min={0}
                      max={question.score}
                      value={draft?.score ?? 0}
                      addonAfter={`/ ${question.score}`}
                      style={{ width: '100%', marginTop: 6 }}
                      onChange={(score) => setDrafts((current) => ({
                        ...current,
                        [question.answer.id]: { score: score ?? 0, feedback: current[question.answer.id]?.feedback ?? '' },
                      }))}
                    />
                  </div>
                  <div>
                    <Text>评语</Text>
                    <TextArea
                      rows={2}
                      value={draft?.feedback ?? ''}
                      style={{ marginTop: 6 }}
                      onChange={(event) => setDrafts((current) => ({
                        ...current,
                        [question.answer.id]: { score: current[question.answer.id]?.score ?? 0, feedback: event.target.value },
                      }))}
                    />
                  </div>
                  <Button type="primary" icon={<SaveOutlined />} loading={savingId === question.answer.id} onClick={() => saveGrade(question.answer.id)}>保存批改</Button>
                </div>
              ) : (
                <Alert
                  type={question.answer.isCorrect ? 'success' : 'error'}
                  showIcon
                  message={`自动判分：${question.answer.isCorrect ? '正确' : '错误'}，得 ${question.answer.finalScore ?? 0} 分`}
                />
              )}
            </Card>
          );
        })}
      </Space>
    </div>
  );
};

export default AttemptGrading;
