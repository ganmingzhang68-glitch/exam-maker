import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, CheckOutlined, MinusCircleOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import type { DifficultyLevel, Question, QuestionType } from '@exam-maker/shared';
import { getQuestion, reviewQuestion, updateQuestion } from '../services/question';
import {
  difficultyLabels,
  questionStatusColors,
  questionStatusLabels,
  questionTypeLabels,
} from '../utils/examLabels';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface QuestionFormValues {
  type: QuestionType;
  stem: string;
  options?: string[];
  answerKeyText?: string;
  analysis?: string;
  scoringRubricText?: string;
  defaultScore: number;
  difficulty?: DifficultyLevel;
  teacherDifficultyScore?: number;
  knowledgePointsText?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

function parseRecord(textValue?: string): Record<string, unknown> | null {
  const value = textValue?.trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Plain teacher-entered answers are stored compatibly as text.
  }
  return { text: value };
}

const QuestionEdit: React.FC = () => {
  const { id } = useParams();
  const questionId = Number(id);
  const navigate = useNavigate();
  const [form] = Form.useForm<QuestionFormValues>();
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const selectedType = Form.useWatch('type', form);
  const isChoice = selectedType === 'single_choice' || selectedType === 'multiple_choice';

  useEffect(() => {
    if (!Number.isInteger(questionId) || questionId <= 0) {
      navigate('/questions', { replace: true });
      return;
    }
    getQuestion(questionId).then((data) => {
      setQuestion(data);
      form.setFieldsValue({
        type: data.type,
        stem: data.stem,
        options: data.options ?? undefined,
        answerKeyText: data.answerKey ? JSON.stringify(data.answerKey, null, 2) : undefined,
        analysis: data.analysis ?? undefined,
        scoringRubricText: data.scoringRubric ? JSON.stringify(data.scoringRubric, null, 2) : undefined,
        defaultScore: data.defaultScore,
        difficulty: data.difficulty ?? undefined,
        teacherDifficultyScore: data.teacherDifficultyScore ?? undefined,
        knowledgePointsText: data.knowledgePoints?.join('，') ?? undefined,
      });
    }).catch((error) => {
      message.error(errorMessage(error, '加载题目失败'));
      navigate('/questions', { replace: true });
    }).finally(() => setLoading(false));
  }, [form, navigate, questionId]);

  const save = async (reviewAfterSave: boolean) => {
    setSaving(true);
    try {
      const values = await form.validateFields();
      const options = values.options?.map((item) => item.trim()).filter(Boolean) ?? [];
      await updateQuestion(questionId, {
        type: values.type,
        stem: values.stem,
        options: isChoice ? options : null,
        answerKey: parseRecord(values.answerKeyText),
        analysis: values.analysis?.trim() || null,
        scoringRubric: parseRecord(values.scoringRubricText),
        defaultScore: values.defaultScore,
        difficulty: values.difficulty ?? null,
        teacherDifficultyScore: values.teacherDifficultyScore ?? null,
        knowledgePoints: values.knowledgePointsText
          ? values.knowledgePointsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean)
          : null,
      });
      if (reviewAfterSave) {
        await reviewQuestion(questionId, 'reviewed');
        message.success('题目已保存并通过审核');
        navigate('/questions/review');
      } else {
        message.success('题目已保存');
        const latest = await getQuestion(questionId);
        setQuestion(latest);
      }
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) return;
      message.error(errorMessage(error, '保存题目失败'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }
  if (!question) return null;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
        <Tag color={questionStatusColors[question.status]}>{questionStatusLabels[question.status]}</Tag>
        {question.aiGenerated && <Tag color="purple">AI 生成</Tag>}
      </Space>
      <Card>
        <Title level={4}>编辑题目</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          来源题号：{question.sourceQuestionNo || '无'}；来源文件 ID：{question.sourceFileId || '无'}
        </Text>
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 16 }}>
            <Form.Item name="type" label="题型" rules={[{ required: true }]}>
              <Select options={Object.entries(questionTypeLabels).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="difficulty" label="难度">
              <Select allowClear options={Object.entries(difficultyLabels).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="defaultScore" label="默认分值" rules={[{ required: true }]}>
              <InputNumber min={0} max={1000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="teacherDifficultyScore" label="教师难度 (0-1)" extra={question.predictedDifficultyScore === null ? '无 AI 预测值' : `AI 预测：${question.predictedDifficultyScore.toFixed(2)}`}>
              <InputNumber min={0} max={1} step={0.05} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="stem" label="题干" rules={[{ required: true, whitespace: true, message: '请输入题干' }]}>
            <TextArea rows={6} />
          </Form.Item>

          {isChoice && (
            <Form.List name="options" rules={[{
              validator: async (_, options) => {
                if (!options || options.filter((item: string) => item?.trim()).length < 2) {
                  throw new Error('选择题至少需要两个选项');
                }
              },
            }]}>
              {(fields, { add, remove }, { errors }) => (
                <Form.Item label="选项" required>
                  {fields.map((field, index) => (
                    <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                      <Text style={{ width: 24 }}>{String.fromCharCode(65 + index)}.</Text>
                      <Form.Item {...field} noStyle rules={[{ required: true, whitespace: true, message: '选项不能为空' }]}>
                        <Input style={{ width: 680 }} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(field.name)} />
                    </Space>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add('')}>添加选项</Button>
                  <Form.ErrorList errors={errors} />
                </Form.Item>
              )}
            </Form.List>
          )}

          <Form.Item
            name="answerKeyText"
            label="参考答案"
            extra="可直接填写文本；已有结构化答案会以 JSON 展示并原样保存。"
          >
            <TextArea rows={4} />
          </Form.Item>
          <Form.Item name="analysis" label="题目解析">
            <TextArea rows={5} />
          </Form.Item>
          <Form.Item name="scoringRubricText" label="评分标准" extra="支持文本或 JSON。">
            <TextArea rows={4} />
          </Form.Item>
          <Form.Item name="knowledgePointsText" label="知识点" extra="多个知识点使用逗号分隔。">
            <Input />
          </Form.Item>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => save(false)}>
              保存修改
            </Button>
            <Button icon={<CheckOutlined />} loading={saving} onClick={() => save(true)}>
              保存并审核通过
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
};

export default QuestionEdit;
