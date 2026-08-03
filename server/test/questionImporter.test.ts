import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeneratedPaperQuestions } from '../src/services/questionImporter.js';

test('generated LaTeX is split into sourced question drafts with answers', () => {
  const latex = String.raw`
\section*{试题}
\section*{一、填空题（每小题 \score{4} 分，共 8 分）}
\begin{enumerate}
\item $1+1=\underline{\hspace{1cm}}$。
\item $2+2=\underline{\hspace{1cm}}$。
\end{enumerate}
\section*{二、证明题（每小题 \score{10} 分，共 10 分）}
\begin{enumerate}
\item 证明命题 A。
\end{enumerate}
\section*{参考答案与评分标准}
\subsection*{一、填空题}
\begin{enumerate}
\item 2。
\item 4。
\end{enumerate}
\subsection*{二、证明题}
\begin{enumerate}
\item 证明过程。
\end{enumerate}`;

  const drafts = parseGeneratedPaperQuestions(latex);
  assert.equal(drafts.length, 3);
  assert.deepEqual(drafts.map((item) => item.sourceQuestionNo), ['1.1', '1.2', '2.1']);
  assert.deepEqual(drafts.map((item) => item.type), ['fill_blank', 'fill_blank', 'essay']);
  assert.deepEqual(drafts.map((item) => item.defaultScore), [4, 4, 10]);
  assert.equal(drafts[0].answerText, '2。');
  assert.equal(drafts[2].answerText, '证明过程。');
});
