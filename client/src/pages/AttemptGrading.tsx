import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  List,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons';
import type { AnswerContent, TeacherAttemptGradingDetail } from '@exam-maker/shared';
import { getAiGradingSuggestion, getTeacherAttemptResult, gradeSubjectiveAnswer, requestAiGradingSuggestion } from '../services/exam';
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

function displayStructuredValue(value: unknown): string {
  return value === null || value === undefined ? '未设置' : JSON.stringify(value, null, 2);
}

const AttemptGrading: React.FC = () => {
  const { id, attemptId: attemptIdParam } = useParams();
  const examId = Number(id);
  const attemptId = Number(attemptIdParam);
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TeacherAttemptGradingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [suggestingId, setSuggestingId] = useState<number | null>(null);
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

  const saveGrade = async (answerId: number, mode: 'accept_ai' | 'modify_ai' | 'manual' = 'manual') => {
    const draft = drafts[answerId];
    if (!draft) return;
    setSavingId(answerId);
    try {
      const suggestion = detail?.questions.find(item => item.answer.id === answerId)?.aiSuggestion;
      const updated = await gradeSubjectiveAnswer(examId, attemptId, answerId, draft.score, draft.feedback,
        mode === 'manual' ? null : suggestion?.id ?? null, mode);
      applyDetail(updated);
      message.success('批改结果和总分已重新计算');
    } catch (error) {
      message.error(errorMessage(error, '保存批改失败'));
    } finally {
      setSavingId(null);
    }
  };

  const generateSuggestion = async (answerId: number) => {
    setSuggestingId(answerId);
    try {
      let suggestion = await requestAiGradingSuggestion(examId, attemptId, answerId);
      for (let attempt = 0; attempt < 80 && ['queued', 'running'].includes(suggestion.status); attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 1500));
        suggestion = await getAiGradingSuggestion(examId, attemptId, answerId);
      }
      const updated = await getTeacherAttemptResult(examId, attemptId);
      applyDetail(updated);
      if (suggestion.status === 'failed') message.error(suggestion.errorMessage ?? 'AI 评分建议生成失败');
      else if (suggestion.status === 'succeeded') message.success('AI 评分建议已生成，请教师复核');
      else message.warning('AI 评分仍在后台运行，可稍后刷新查看');
    } catch (error) { message.error(errorMessage(error, 'AI 评分建议生成失败')); }
    finally { setSuggestingId(null); }
  };

  const acceptSuggestion = async (answerId: number, score: number) => {
    setDrafts(current => ({ ...current, [answerId]: { score, feedback: current[answerId]?.feedback ?? '' } }));
    setSavingId(answerId);
    try {
      const suggestion = detail?.questions.find(item => item.answer.id === answerId)?.aiSuggestion;
      const updated = await gradeSubjectiveAnswer(examId, attemptId, answerId, score,
        drafts[answerId]?.feedback ?? '', suggestion?.id ?? null, 'accept_ai');
      applyDetail(updated); message.success('已由教师确认 AI 建议并重新计算总分');
    } catch (error) { message.error(errorMessage(error, '接受 AI 建议失败')); }
    finally { setSavingId(null); }
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
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{displayStructuredValue(question.answerKey)}</pre>
                {question.analysis && <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>解析：{question.analysis}</Paragraph>}
              </Card>
              {question.subjective && <Card size="small" type="inner" title="逐项评分标准" style={{ marginBottom: 12 }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{question.scoringRubric ? JSON.stringify(question.scoringRubric, null, 2) : '未设置；设置 Rubric 后才能使用 AI 评分建议。'}</pre>
              </Card>}
              {question.subjective ? (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Card size="small" title={<Space><RobotOutlined />AI 评分建议<Tag color="blue">仅供教师参考</Tag></Space>} extra={
                    <Button icon={<RobotOutlined />} disabled={!question.scoringRubric} loading={suggestingId === question.answer.id} onClick={() => generateSuggestion(question.answer.id)}>
                      {question.aiSuggestion ? '重新生成建议' : '生成建议'}
                    </Button>
                  }>
                    {!question.aiSuggestion && <Text type="secondary">尚未生成。AI 不会自动提交最终成绩。</Text>}
                    {question.aiSuggestion && ['queued', 'running'].includes(question.aiSuggestion.status) && <Alert type="info" showIcon message="AI 评分正在后台运行" />}
                    {question.aiSuggestion?.status === 'failed' && <Alert type="error" showIcon message="建议生成失败" description={question.aiSuggestion.errorMessage} />}
                    {question.aiSuggestion && ['succeeded', 'accepted', 'modified'].includes(question.aiSuggestion.status) && <Space direction="vertical" style={{ width: '100%' }}>
                      {question.aiSuggestion.confidence !== null && question.aiSuggestion.confidence < 0.6 && <Alert type="warning" showIcon message="AI 置信度较低，建议人工重点复核" />}
                      <Space><Statistic title="建议分" value={question.aiSuggestion.suggestedScore ?? 0} suffix={`/ ${question.aiSuggestion.maxScore}`} /><Tag>{question.aiSuggestion.model ?? '未知模型'}</Tag><Tag>置信度 {question.aiSuggestion.confidence?.toFixed(2) ?? '—'}</Tag></Space>
                      <Text>{question.aiSuggestion.reasoningSummary}</Text>
                      <List size="small" bordered dataSource={question.aiSuggestion.rubricItemScores} renderItem={item => <List.Item>
                        <Space direction="vertical" size={0}><Text strong>{item.rubricItemId}：{item.awardedScore}/{item.maxScore} 分</Text><Text type="secondary">{item.evidenceSummary}</Text></Space>
                      </List.Item>} />
                      <Button type="primary" disabled={question.aiSuggestion.suggestedScore === null} onClick={() => acceptSuggestion(question.answer.id, question.aiSuggestion!.suggestedScore!)}>教师确认并接受建议</Button>
                    </Space>}
                  </Card>
                  <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 12, alignItems: 'end' }}>
                  <div>
                    <Text>得分</Text>
                    <InputNumber
                      min={0}
                      max={question.score}
                      value={draft?.score ?? 0}
                      style={{ width: '100%', marginTop: 6 }}
                      onChange={(score) => setDrafts((current) => ({
                        ...current,
                        [question.answer.id]: { score: score ?? 0, feedback: current[question.answer.id]?.feedback ?? '' },
                      }))}
                    />
                    <Text type="secondary">满分 {question.score}</Text>
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
                  <Button type="primary" icon={<SaveOutlined />} loading={savingId === question.answer.id} onClick={() => saveGrade(question.answer.id, question.aiSuggestion ? 'modify_ai' : 'manual')}>保存教师评分</Button>
                  </div>
                </Space>
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
