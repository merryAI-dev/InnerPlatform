export interface ProjectTeamMemberOption {
  value: string;
  name: string;
  nickname: string;
  label: string;
}

const RAW_PROJECT_TEAM_MEMBERS = `
김정태	에이블
이예지	메씨리
김세은	람쥐
유자인	유자
나미소	쏘
박정호	스템
김선미	해니
이정선	보노
고인효	베리
하윤지	하모니
송영일	우슬
김영우	앵커
정지윤	유니
강신일	봄날
장란영	바닐라
김다은	데이나
이지현A	리사
윤지수	이나
백지연	제리
송성미	도담
해민영	썬
한형규	데일리
송지효	송죠
장은희	나무
김빛고을	브이
이승연	뽀승
변준재	제이
하누리	주디
최종옥	가드너
김현지	데이지
민가람	담마
곽민주	노아
심지혜	쿠키
권혁준	준
김혜원	모토
최지윤	써니
김민주B	만두
최유진	고야
서민종	파커
김혜령	테일러
김신영	가든
김준성	더준
신예진	진신
정지연	모모
강신혁	강케이
이준철	철쭉
이한선	안소니
이지현B	올리브
박진영	그린
이현송	하모
김민선	포비
권상준	런던
최상배	루크
임종수	스티븐
박연주	연두
하송희	솔
현우정	로에
이동완	허브
김예빈	하얀
백민혁	혜윰
강민경	마고
강현주	헤일리
변민욱	보람
강혜진	트루
권혜연	호두
양인영	엠마
조이수	수
전우철	프코
김민주C	코지
조아름	다온
백수미	포용
정재우	피터
현빈우	에리얼
고혜림	멜론
이시은	싱아
한연지	태중
김혜린	니아
방예원	숲
박지연	느티
이지영	이지
조정은	우디
김미연	메이
`.trim();

export const PROJECT_TEAM_MEMBER_OPTIONS: ProjectTeamMemberOption[] = RAW_PROJECT_TEAM_MEMBERS
  .split('\n')
  .map((line) => {
    const [name, nickname] = line.split('\t').map((value) => value.trim());
    return {
      value: name,
      name,
      nickname,
      label: `${name} (${nickname})`,
    };
  });

export const PROJECT_TEAM_MEMBER_OPTION_MAP = Object.fromEntries(
  PROJECT_TEAM_MEMBER_OPTIONS.map((option) => [option.value, option]),
) as Record<string, ProjectTeamMemberOption>;
