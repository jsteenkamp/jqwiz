/* jqwiz plugin
 * Copyright (c) 2010 Johan Steenkamp (http://www.orbital.co.nz)
 * Requires: jQuery 1.4.x
 * Adds quiz to selected element. Requires quiz Q + A in Google Docs spreadsheet (see example for format)
 * Usage: $(selector).jqwiz({title, key, gid, cache})
 * Version 0.1
 * Last Updated: 29-12-2010
 * YQL: http://query.yahooapis.com/v1/public/yql?q={yql query}&diagnostics={true|false}&format={json|xml}&callback={function name}
 * Note: You must specify yql callback param for MSIE/Opera otherwise you get a misleading access denied jQuery error
 */

(function($){
	$.fn.jqwiz = function(settings){
		
		// default settings		
		$.fn.jqwiz.defaults = {
			title: 'jqwiz', // app title bar text
			key: '0ApY46l664W_jdFY1SDZGanF4ellYSzVxZzZ0QVFkSEE', // google docs spreadsheet key (example - read only)
			gid: 0, // spreadsheet gid number available in spreadsheet URL
			lang: 'en', // i18n language code
			oneclick: true, // single quick marks question and advances to next question
			cache: true // cache YQL requests result data
		};	
			
		// config using any passed settings
		settings = $.extend({}, $.fn.jqwiz.defaults, settings);
		
		// jqwiz globals 
		var $quizParent = $(this),
			$quizWrapper,
			$quizContainer,
			$quizHeader,
			$quizTitle,			
			$quizBack,
			$quizTime,
			$quizContent,
			$quizPrev,
			$quizCount,
			$quizNext,
			$quizSpinner,
			yqlRequests = {}, // request cache
			yqlResults = [],
			yqlRows = 0,
			yqlCols = 0,
			yqlRetries = 0,
			quizFinish = false, // enable next button to access final score
			quizTimeExpired = false,			
			quizState = 'start', // app state
			quizList = [], // [list of quizzes] (cached so not reloaded when re-selecting list)
			quizData = {}, // {quiz}
			quizTime = 0,  // timestamp for timed quiz
			quizElapsedTime = 0,
			quizTimers = [], 
			qTotal = 0, // total number of questions
			qCurrent = 0, // current question number
			qTotalCorrect = 0, // number of correct questions
			qTotalAnswered = 0, // number of questions answered for running score
			qAnswers = [], // array - stores selected answer index for review
			fadeOut = 700, // UI transistion times
			fadeIn = 300,
			i18n = {
				// localization 'bundles' - add your own here
				en: {
					'answered': 'Answered',
					'correct': 'Correct',
					'loading': 'Loading',
					'start': 'Start',
					'score': 'Score',
					'time': 'Time',
					'time-expired': 'Time Expired'
				},
				jp: {
					'answered': '回答',
					'correct': '正しい',
					'loading': 'ロード',
					'start': '開始',
					'score': 'スコア',
					'time': '時間',
					'time-expired': '時間が期限切れ'
				}
			}; 


		/* * * INITIALIZATION * * */

		(function(){
			// parse url for key = value pairs and replace/add to settings
			if (window.location.search){
				var temp = window.location.search.replace('?','').split('&');
				for (var i = 0, p; p = temp[i++];){
					var j = p.split('=');
					if (j.length === 2){
						settings[j[0].toLowerCase()] = j[1];	
					}
				}
			};
		
			
			// if set i18n lang does not exist then default to english
			settings.lang = i18n[settings.lang] ? settings.lang : 'en'; 
			
			// build quiz containers
			$('<div class="quizWrapper">' + 
				'<div class="quizContainer listView">' +
					'<div class="quizHeader">' + 
						'<h2>'+ settings.title + '</h2>' +
						'<div class="quizBack disabled"></div>' +
						'<div class="quizTime"></div>' +
						'<div class="quizCount"></div>' +
						'<div class="quizPrev disabled"></div>' +
						'<div class="quizNext disabled"></div>' +
					'</div>' +
					'<div class="quizContent"></div>' +
				'</div>' +
				'<div class="quizSpinner">' + i18n[settings.lang]['loading'] + '</div>' +
			'</div>').appendTo($quizParent);
			
			// cache matched sets
			$quizWrapper = $quizParent.find('.quizWrapper');
			$quizContainer = $quizWrapper.find('.quizContainer');
			$quizHeader = $quizContainer.find('.quizHeader');
			$quizTitle = $quizHeader.find('h2');
			$quizBack = $quizHeader.find('.quizBack');
			$quizTime = $quizHeader.find('.quizTime');
			$quizCount = $quizHeader.find('.quizCount');
			$quizPrev = $quizHeader.find('.quizPrev');
			$quizNext = $quizHeader.find('.quizNext');
			$quizContent = $quizContainer.find('.quizContent');				
			$quizSpinner = $quizWrapper.find('.quizSpinner');
			
			/* EVENTS */
			
			// enable list (quiz/answer) selection
			$quizContainer.bind('enable-list', function(){			
				$quizContent.delegate('li', 'click', function(){
					var $this = $(this);
					// mark question or change state
					if ($quizContainer.hasClass('listView')){
						$this.data() ? loadQuiz($this.data('key'), $this.data('gid')) : loadQuiz(settings.key, settings.gid); // quiz list view passes key/gid data with query
					} else if ($this.hasClass('select')){
						$quizNext.trigger('click'); // select answer and advance	
					} else {
						// only 1 answer can be selected - otherwise change selected answer state		
						$quizContent.find('li').removeClass('select');
						$this.addClass('select');
						// one click - select / mark / next with single click
						settings.oneclick ? $quizNext.trigger('click') : $quizNext.attr('disabled', false);													
					}
					return false;
				});
			});
	
	
			// disable list
			$quizContainer.bind('disable-list', function(){
				$quizContent.undelegate('li', 'click');
			});
	
		
			// clear selection
			$quizContainer.delegate('.quizStart', 'click', function(){
				$quizNext.trigger('click');
				return false;
			});

		
			// buttons
			$quizBack.bind('click', function(){
				if (!$quizBack.hasClass('disabled')){
					$quizBack.addClass('disabled');					
					quizList.length ? startList() : startQuiz();
				}
				return false;
			});


			$quizPrev.bind('click', function(){
				if (!$quizPrev.hasClass('disabled')){
					$quizPrev.addClass('disabled');									
					displayQuestion(false);	// decrement				
				}
				return false;
			});


			$quizNext.bind('click', function(){
				if (!$quizNext.hasClass('disabled')){
					$quizNext.addClass('disabled');
					displayQuestion(true); // increment					
				}
				return false;
			});

			// mobile events
			$quizContainer.bind('swipeleft', function(){
				if (quizFinish){
					$quizPrev.trigger('click');
				}
			});

			$quizContainer.bind('swiperight', function(){
				if (quizFinish){
					$quizNext.trigger('click');
				}
			});

			// make content links open in a new tab
			$quizContainer.bind('external-links', function(){
				$quizContent.find('a').attr('target', '_blank');
			});

			// reset time and clear timer
			$quizContainer.bind('reset-timer', function(){
				quizTime = null;
				clearTimeout(quizTimers[1]);
			});
			
			
			// ajax activity spinner
			$quizParent.bind('spinner-show', function(){
				$quizSpinner.show();
			});
			
			$quizParent.bind('spinner-hide', function(){
				$quizSpinner.hide();
			});
			
			//ajax errors
			$quizParent.bind('jqwiz-error', function(event, data){
				$quizContent.empty().html('<div class="quizError">Error: ' + data + '</div>').trigger('spinner-hide');						
			});
			
			// initial load from settings
			loadQuiz(settings.key, settings.gid);
		})();
		
		
		/* * * JQWIZ * * */ 
			
		function startList(){
			quizState = 'start';
			quizFinish = false;			
			
			var $ul = $('<ul class="quizList">');
				
			// generate list of quiz titles
			for (var i = 0, item; item = quizList[i++];){
				$('<li>').data({gid: item.gid, key: item.key}).html(item.title + '<div class="icon"></div>').appendTo($ul);
			}
			
			$quizContent.fadeOut(fadeOut, function(){
				$quizContainer.addClass('listView');
				$quizHeader.show();
				$quizTitle.show();	
				$quizBack.addClass('disabled').hide();
				$quizPrev.addClass('disabled').hide();
				$quizNext.addClass('disabled').hide();
				$quizTime.hide();
				$quizCount.hide();
				$quizContent.html($('<div>').append($ul)).fadeIn(fadeIn).trigger('enable-list'); // div container makes it easier to select/remove/add new question/content
			}).trigger('reset-timer');
		};
		
		
		
		function startQuiz(){
			// reload quickfires since source question array is reduced to results only
			if (quizFinish && quizData.options.quickfire){
				quizFinish = false; // IMPORTANT: otherwise endless reload loop!
				loadQuiz(settings.key, settings.gid);
			} else {
				quizState = 'next';
				quizFinish = false;
				quizTimeExpired = false;
							
				qTotal = quizData.questions.length;
				qCurrent = 0;
				qTotalCorrect = 0;
				qTotalAnswered = 0;
				qAnswers = [];
	
				$quizContent.fadeOut(fadeOut, function(){
					$quizHeader.show();					
					$quizContainer.removeClass('listView');
					$quizTitle.hide();
					quizList.length ? $quizBack.removeClass('disabled').show() : $quizBack.addClass('disabled').show();
					$quizPrev.addClass('disabled');
					$quizNext.removeClass('disabled');
					$quizTime.html(formatTime(quizData.options.time ? quizData.options.time : 0)).show(); // display time for timed quiz
					$quizCount.html(qTotal).show();
					$quizContent.html($('<div><h3>' + quizData.title + '</h3><div class="quizMessage">' + quizData.description + '</div><div class="quizStart">Start</div></div>')).fadeIn(fadeIn).trigger('external-links');
				}).trigger('disable-list').trigger('reset-timer');
			}
		};
		
		
		
		function displayQuestion(next){
			// process current question before increment/decrement
			if (quizState === 'mark' && $quizContent.find('li.select').length){
				markQuestion();
			}
			
			// next or previous
			next ? qCurrent++ : --qCurrent;
			
			// output question and answers
			if (qCurrent > 0 && qCurrent <= qTotal){			
				quizState = 'mark';
				// ensure valid start question number - rapid fire can result in qn > qTotal
				if(quizData.questions[qCurrent - 1]){
					var question = quizData.questions[qCurrent - 1],
						$container = $('<div>').append($('<h3>').html(question.text)),
						$ul = $('<ul class="quizList">');
					
					// output answers
					for (var i = 0, items = question.answers.length; i < items; i++){
						var item = question.answers[i];
						// previous = review questions then show answer selection
						if (qAnswers[qCurrent - 1] !== undefined){
							quizState = 'next';
							var itemClass = (i === qAnswers[qCurrent - 1] ? 'select ' : '') + (item.correct ? 'isRight' : 'isWrong');
							$('<li>').data('correct', item.correct).addClass(itemClass).html(item.text + '<div class="icon"></div>').appendTo($ul);
						} else {
							$('<li>').data('correct', item.correct).html(item.text + '<div class="icon"></div>').appendTo($ul);
						}
					}
									
					$container.append($ul);
						
					// we always have a container div to remove
					$quizContent.fadeOut(fadeOut, function(){
						$quizCount.html(qCurrent + '/' + qTotal);
						(qCurrent - 1) ? $quizPrev.removeClass('disabled') : $quizPrev.addClass('disabled');
						$quizNext.removeClass('disabled');
						$quizContent.empty().append($container).fadeIn(fadeIn, function(){
							if (qCurrent === 1 && qAnswers.length === 0){
								timeQuiz(); // start quiz timer when question is visible - do not restart if reviewing answers
								if (!quizList.length){
									$quizBack.removeClass('disabled'); // enable "Start" button for single quiz									
								}
							} else if (quizTimeExpired && !quizFinish){
								finishQuiz(); // handle time expiry simultaneous with user selecting next question
							}
						}).trigger('external-links');
						// enable answer selection
						if (!quizFinish){
							$quizContent.trigger('enable-list');
						}
					}).trigger('disable-list');
				}
			} else {
				finishQuiz();
			}
		};

		
		
		function markQuestion(){
			quizState = 'next';
			// check if already marked			
			if (!qAnswers[qCurrent - 1]){
				var qCorrect = true
					answer = -1;
				
				$quizContent.find('li').each(function(index){
					var $this = $(this),
						isCorrect = $this.data('correct');
					
					// show right / wrong answers - CSS sets icon for selected item
					$this.addClass(isCorrect ? 'isRight' : 'isWrong');
					
					// track which answer was selected
					if ($this.hasClass('select')){
						answer = index;
						qTotalAnswered++;
						qCorrect = qCorrect == isCorrect; // if multiple selected and any wrong then you are wrong!					
					}
				});
				
				if (qCorrect){
					qTotalCorrect++;
				}
				// track answer for previous/next review
				qAnswers[qCurrent - 1] = answer;
			}
		};


		
		function finishQuiz(){
			quizState = 'finish';

			if (!quizFinish){
				// quickfire - only answered questions used in result/grade
				if (quizData.options.quickfire){
					var tempQuestions = [],
						tempAnswers = [];
					// rebuild question/answers	
					for (var i = 0, len = qAnswers.length; i < len; i++){
						if (qAnswers[i] !== undefined){
							tempQuestions.push(quizData.questions[i]);
							tempAnswers.push(qAnswers[i]);
						} 
					}
					quizData.questions = tempQuestions;
					qAnswers = tempAnswers;
					// update totals	
					qTotal = qAnswers.length;
					qCurrent = qTotal;
					$quizCount.html(qCurrent++ + '/' + qTotal); // increment for previous selection
					
				} else {	
					// ensure valid pointer for prev/next if user did not answer anything before expiry
					qCurrent = qTotalAnswered ? qCurrent : qTotal + 1;
					// set default answer element index for all un-answered questions
					for (var i = 0; i < qTotal; i++){
						if (qAnswers[i] === undefined){
							qAnswers[i] = -1;
						} 
					}
				}
			}
			
			var score = qTotal ? Math.round(qTotalCorrect / qTotal * 100) : 0,
				msg = '<div>' +
						'<div class="quizResults">' + 
							'<h3>' + i18n[settings.lang]['score'] + ': ' + score + '%</h3>' +
							'<ul>' +
								'<li>' + i18n[settings.lang]['answered'] + ': ' + qTotalAnswered + '/' + qTotal + '</li>' +
								'<li>' + i18n[settings.lang]['correct'] + ': ' + qTotalCorrect + '/' + qTotal + '</li>' +
								'<li>' + (quizTimeExpired ? i18n[settings.lang]['time-expired'] + ': (' + quizElapsedTime + ')' : i18n[settings.lang]['time'] + ': ' + quizElapsedTime) + '</li>' +
							'</ul>' +
						'</div>' + 
						'<div class="quizMessage">' + quizData.message + '</div>' +
					'</div>';

			$quizContent.fadeOut(fadeOut, function(){
				qTotal ? $quizPrev.removeClass('disabled') : $quizPrev.addClass('disabled');
				$quizNext.addClass('disabled');
				$quizContent.empty().append($(msg)).fadeIn(fadeIn, function(){
					quizFinish = true; // IMPORTANT: set here to deal with delays due to UI transitions (quickfire) 
				}).trigger('external-links');
			}).trigger('disable-list').trigger('reset-timer');
		};



		function timeQuiz(){
			var d = new Date();
			// set time interval relative to system clock
			if (!quizTime){
				quizTime = (d.getHours() * 60 * 60) + (d.getMinutes() * 60) + d.getSeconds() + quizData.options.time;
			}
			// get remaining time compared to system clock (js timers are async), format time display
			var current = d.getHours() * 60 * 60 + d.getMinutes() * 60 + d.getSeconds(),
				qtime = quizData.options.time ? quizTime - current : current - quizTime;
				 
			quizElapsedTime = formatTime(quizData.options.time ? quizData.options.time - qtime : qtime);
			$quizTime.html(formatTime(qtime));
			
			// do not continue if user finished but has not pressed button
			if (!quizFinish){
				if (quizData.options.time){
					if (qtime > 0){
						quizTimers[1] = setTimeout(timeQuiz, 250); // count down timer
					} else {
						quizTimeExpired = true; 
						quizElapsedTime = formatTime(quizData.options.time); // devices like iPod touch do not process timer during ui interaction						
						finishQuiz();
					}
				} else {
					quizTimers[1] = setTimeout(timeQuiz, 250); // count up timer
				}
			}
		};
		
		

		/* * * AJAX * * */

		// load quiz data from google docs spreadsheet using YQL
		function loadQuiz(key, gid){
			var csvURL = encodeURIComponent('https://spreadsheets.google.com/pub?key=' + key + '&gid=' + gid + '&output=csv&single=true'),
				yqlURL = 'http://query.yahooapis.com/v1/public/yql?q=' + encodeURIComponent('select * from csv where url="') + csvURL + '"&format=json&callback=?',
				timeout = 20000, // 20 seconds
				loadTimer = setTimeout(function(){
					$quizParent.trigger('jqwiz-error', 'Unable to process request at this time');
				}, timeout + 2000),
				parseData = function(yqlData){
					try{
						// if YQL fails timer will show error - YQL: "Failed to load resource: the server responded with a status of 999 (Unable to process request at this time -- error 999)"
						clearTimeout(loadTimer);
						
						if (yqlData.query.count){
							yqlResults = yqlData.query.results.row;
							yqlRows = yqlResults.length; // data rows - same as yqlData.query.count
							
							// display quiz list or quiz
							var isQuizList = yqlResults[0].col0.toLowerCase() === 'gid',
								arrCols = isQuizList ? yqlResults[0] : yqlResults[2]; 
	
							yqlCols = 0;
							// find number of properties (keys) to determine number of columns (and max number of answers)
							for (var k in arrCols){
								if (arrCols.hasOwnProperty(k)){
									yqlCols++;
								}
							}
	
							yqlRequests[key][gid] = yqlData;
							// callback
	 						isQuizList ? quizListData() : quizQuestionData(key, gid);
						} else {
							$quizParent.trigger('jqwiz-error', 'No quiz data');						
						}
					}
					// handle any data parsing errors (bad/no data)
					catch(err){
						if (!yqlRetries++){
			              	loadQuiz(key, gid); 
						} else {
							$quizParent.trigger('jqwiz-error', 'Processing quiz data');
						}						
					}
					
				};
				
			// request cache
			yqlRequests[key] = settings.cache ? yqlRequests[key] || [] : [];

			if (!settings.cache || (settings.cache && !yqlRequests[key][gid])){
				// activate spinner - jsonp requests do not fire beforeSend()	
				$quizParent.trigger('spinner-show');
							
				$.ajax({
					url: yqlURL,
					context: $quizParent,
					success: parseData,
					error: function(xhr, textStatus, error) {
						clearTimeout(loadTimer);
						$quizParent.trigger('spinner-hide');
			            if(xhr.status === 401 || xhr.status === 403) { // unauthorized, forbidden
							// redirect action here
			            } else if (xhr.status === 504 && !yqlRetries++) { // gateway timeout - 1 retry
			              	loadQuiz(key, gid); 
			            } else {					
							$quizParent.trigger('jqwiz-error', 'Unable to load quiz (' + xhr.status + ')');
						}
					},
					complete: function(){
						$quizParent.trigger('spinner-hide');
					},
					dataType: 'json',
					timeout: timeout,
					global: false,
					cache: true
				});
			} else {
				parseData(yqlRequests[key][gid]);
			}
		};
		


		function quizListData(){
			// valid list of quizzes must have at least 2 columns and 2 rows
			// 0 - header row
			// 1.0 gid, 1.1 title, [1.2 description], [1.3 key] 

			if (yqlRows > 1 && yqlCols > 1){
				try{
					quizList = [];
					for (var i = 1; i < yqlRows; i++){
						quizList.push({
										gid: parseInt(cleanQuotes(yqlResults[i].col0)),
										key: cleanQuotes(yqlResults[i].col1) || settings.key, 
										title: cleanQuotes(yqlResults[i].col2),
										description: cleanQuotes(yqlResults[i].col3)
									});
					}					
					
					// display list of quizzes
					startList();
				}
				catch(err){
					$quizParent.trigger('jqwiz-error', 'Parsing quiz list');					
				} 
			} else {
				$quizParent.trigger('jqwiz-error', 'Invalid quiz list data');				
			}
		};



		function quizQuestionData(key, gid){
			// used to randomize array
			function fisherYates(arr){
			  var i = arr.length;
			  while (--i){
			     var j = Math.floor(Math.random() * (i + 1)),
				 	tempi = arr[i],
					tempj = arr[j];
					
			     arr[i] = tempj;
			     arr[j] = tempi;
			   }
			};

			// valid quiz must have at least 4 columns and 4 rows:
			// 0 - header row 
			// 1.0 title, 1.1 description, [1.2 message], [1.3 options (time, random, ...)] 
			// 2 - header row 
			// 3.0 question, 3.1 correct answer, 3.2 incorrect answer, [3.3 incorrect answer], ... 

			if (yqlRows > 3 && yqlCols > 3){
				try{
					// convert result rows into question / answer objects
					quizData = {
							title: cleanQuotes(yqlResults[1].col0),
							description: cleanQuotes(yqlResults[1].col1),
							message: cleanQuotes(yqlResults[1].col2),
							options: {time: 0, random: false, questions:0, quickfire: false, mark: true},
							questions: [],
							key: key,
							gid: gid
						};

					// convert options to valid object
					if (yqlResults[1].col3){
						var options = cleanQuotes(yqlResults[1].col3).split(',');
						// ensure valid data with key, value pairs
						for (var i = 0, opt; opt = options[i++];){
							var option = opt.split('=');
							if (option.length == 2){
								var	key = $.trim(cleanQuotes(option[0])),
									value = $.trim(cleanQuotes(option[1])).toLowerCase();
								// type data
								if (!isNaN(value)){
									value = parseInt(value);
								} else if (value == 'true' || value == 'false'){
									value = value == 'true';
								}
								quizData.options[key] = value;
							}
						}
						
						// convert time to seconds
						if (typeof quizData.options.time === 'string'){
							var arr =  quizData.options.time.split(':'),
								seconds = 0;
							switch (arr.length){
								case 3:
									seconds = parseInt(arr[0]) * 60 * 60 + parseInt(arr[1]) * 60 + parseInt(arr[2]); 	
									break;
									
								case 2:
									seconds = parseInt(arr[0]) * 60 + parseInt(arr[1]); 	
									break;
			
								default:								 					
									seconds = 0; // invalid time - time can only contain hh:mm:ss, mm:ss or ss
							}
							quizData.options.time = seconds;
						}	
					}
					
					// loop over remaining rows and create question / answer objects
					for (var i = 3; i < yqlRows; i++){
						if (yqlResults[i].col1){
							var question = {
											text: cleanQuotes(yqlResults[i].col0),
											answers: [{text: cleanQuotes(yqlResults[i].col1), correct: true}] // answer - first is correct
										};
							// answers - add remaining
							for (var j = 2; j < yqlCols; j++){
								if (yqlResults[i]['col' + j]){
									question.answers.push({text: cleanQuotes(yqlResults[i]['col' + j]), correct: false});
								}
							}	
							// randomize answers
							fisherYates(question.answers);
							// add question + answers to quiz
							quizData.questions.push(question); 
						}
					}
					
					// randomize questions
					if (quizData.options.random){
						fisherYates(quizData.questions);
					}
					
					// reduce number of questions if required 
					if (quizData.options.questions && quizData.options.questions < quizData.questions.length){
						quizData.questions = quizData.questions.slice(0, quizData.options.questions);
					}
					
					// display quiz
					startQuiz(); 
				}
				catch(err){
					$quizParent.trigger('jqwiz-error', 'Parsing quiz questions');							
				}
			} else {
				$quizParent.trigger('jqwiz-error', 'Invalid quiz question data');
			}
		};



		/* * *  UTILITIES * * */
		// YQL response can contain extra double quotes - test undefined || null
		// Convert image links to tags to render image
		// General regex for urls from http://lawrence.ecorp.net/inet/samples/regexp-parse.php
		function cleanQuotes(str){
			return str ? str.replace(/""/g,'"').replace(/^"|"$/g,'').replace(/(^((https?):\/)?\/?([^:\/\s]+)((\/\w+)*\/)([\w\-\.]+\.(png|jpg|gif))$)/gi, '<img src="$1"/>') : '';
		};
		

		// format integer time (seconds) to mm:ss string
		function formatTime(time){
			// devices like iPod touch do not process timer during ui interaction resulting in negative value
			time = time < 0 ? 0 : time; 
			var hrs = Math.floor(time / 3600),
				mins = Math.floor((time - hrs * 3600) / 60),
				secs = time - hrs * 3600 - mins * 60;
				// leading 0 for mins:secs - blank hours unless needed
				hrs = hrs ? hrs + ':' : '';
				mins = mins < 10 ? '0' + mins : mins;
				secs = secs < 10 ? '0' + secs : secs;
				return hrs + mins + ':' + secs;
		};


		/* * * CHAINING * * */
		return this; // return jquery object
	};	
})(jQuery);

