# **INSTALLS & IMPORTS**
import requests
import json
import re
import gradio as gr
from typing import List

# **DEFINE GLOBAL VARIABLES**
MODEL_NAME = "llama3.1:8b-instruct-q8_0"
FINAL_RESPONSE_REGEX = ">>> \*\*[^\*]+\*\*: .*"
MAX_FACTORS = 8


# **DEFINE FUNCTIONS**
## **CREATE POST API given prompt & optional display options is_streaming**
def create_POST_API(prompt: str, is_streaming: bool):
    return requests.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": MODEL_NAME,
                    "prompt": prompt,
                    "stream": is_streaming
                },
                stream=is_streaming
            )

## **STREAM OUTPUT**
def stream_output(response):
    full_text_response = ""
    for line in response.iter_lines():
        if line:
            data = json.loads(line.decode("utf-8"))
            token = data.get("response", "")
            print(token, end="", flush=True)
            full_text_response += token
    return full_text_response

## **PARSE RESPONSE**
def parse_final_response(final_response: str):
    matches = re.findall(FINAL_RESPONSE_REGEX, final_response)
    if matches:
      if (len(matches) > MAX_FACTORS):
          matches[MAX_FACTORS] # Only get first MAX_FACTORS number of factors from matches
      else:
          return matches
    else:
        print("Unable to get factors.")
        print(final_response)
        return None

## **WRITE PARSED FINAL RESPONSE TO .TXT FILE**
def save_selected_factors(selected_factors):
    if selected_factors:
        considered_factors = "\n".join(selected_factors)
        with open("considered_factors.txt", "w") as file:
            file.write(considered_factors)
        return considered_factors
    else:
        return None

## **RUNS ALL ABOVE FUNCTIONS TO GENERATE RELEVANT FACTORS**
def generate_factors(user_query: str) -> List[str]:
    print("1. Extracting the main subject from your query...")
    query_subject = "None"
    prompt_to_extract_subject_from_query = f"If Input is graphically inappropriate, violent, or dangerous, return only the word “None”. Else, extract the main subject of this Input and never include any locational information in the main subject. Return only the main subject and nothing else, like: ‘main subject’\n You do not need to output sensitive or private information, simply extract and output exact wording of subject from query### Input: ’{user_query}’."
    response_query_subject = create_POST_API(prompt_to_extract_subject_from_query, is_streaming=False)
    query_subject = response_query_subject.json()["response"]
    #print(query_subject) # Delete in production

    print("\n2. Thinking of relevant factors to main subject of your query...")
    query_unordered_factors_list = "None"
    prompt_to_list_factors_related_to_subject = f"Given query: {user_query} and subject: {query_subject}, identify and list {MAX_FACTORS} or less macro-environmental, socio-economic, and or other large-scale factors that have been proven to influence, contribute to, or affect Subject. You are allowed to be specific as long as factors are proven to be the most relevant and most impactful. Ex: environmental variables (e.g., pollution, contaminants, climate, natural disasters), socio-economic factors (e.g., income, education, healthcare access), demographic data (e.g., age, race, population density), infrastructure (e.g., transportation, housing quality), and or other broad-scale elements. Follow this format exactly: begin with list '>>> **factorName**: conciseExplanationOfWhyFactorChosenAndSourceUsed'. Do not add any other explanations or notes."
    response_query_unordered_factors_list = create_POST_API(prompt_to_list_factors_related_to_subject, is_streaming=False)
    query_unordered_factors_list = response_query_unordered_factors_list.json()["response"]
    #print(query_unordered_factors_list) # Delete in production

    print("\n3. Reordering relevant factors from most to least relevant to your query...")
    query_ordered_factors_list = "None"
    prompt_to_reorder_factors_by_impact = f"Given query: {user_query} and List of relevant factors: {query_unordered_factors_list}. Verify that the factors are all true. Remove any factor, factor’s selection explanation and factor’s source if it is untrue, finally reorder factors based on most to least impactful factors given query. Never generate or add new factors. Never change the factor name or its explanation, simply rearrange list ordering. Follow this format exactly: begin with reordered list '>>> **factorName**: conciseExplanationOfWhyFactorChosenAndSourceUsed' then at the end of entire list 'explanation of removed factors'. Do not add any other explanations or notes."
    response_query_ordered_factors_list = create_POST_API(prompt_to_reorder_factors_by_impact, is_streaming=False) #is_streaming=True
    query_ordered_factors_list = response_query_ordered_factors_list.json()["response"] # stream_output(response_query_ordered_factors_list)
    #print(query_ordered_factors_list) # Delete in production

    print("\n4. Parsing response to only inlcude factors list")
    factors = parse_final_response(query_ordered_factors_list)
    print(factors)
    return gr.CheckboxGroup(factors, value=factors) # By default, pre-select all factors for use

## **SAVE USER-SELECTED FACTORS TO .TXT FILE & DISPLAY WRITTEN CONTENTS TO UI**
def save_selected_factors(selected_factors: List[str]) -> str:
    if selected_factors:
        considered_factors = "\n".join(selected_factors)
        with open("considered_factors.txt", "w") as file:
            file.write(considered_factors)
        return considered_factors
    else:
        return None

    
# **RUN PROGRAM**
#factors = ['>>> **Smoking Prevalence**: Smoking is a leading cause of lung cancer, and Missouri has one of the highest smoking prevalence rates in the country (Source: Centers for Disease Control and Prevention).', '>>> **Access to Healthcare**: Limited access to healthcare services can hinder early detection and treatment of pulmonary cancer, leading to poorer outcomes (Source: Kaiser Family Foundation).', '>>> **Air Pollution**: Exposure to poor air quality can increase the risk of lung cancer, particularly in urban areas like Kansas City and St. Louis (Source: Environmental Protection Agency).', '>>> **Ethnicity and Race**: African Americans are disproportionately affected by lung cancer in Missouri, with higher incidence rates compared to white individuals (Source: Missouri Department of Health and Senior Services).', '>>> **Occupational Exposures**: Workers in certain industries, such as mining and construction, may be exposed to carcinogens that increase their risk of developing pulmonary cancer (Source: National Institute for Occupational Safety and Health).', '>>> **Rural-Urban Divide**: Rural Missouri residents often have limited access to healthcare services, which can exacerbate health disparities and worsen pulmonary cancer outcomes (Source: National Cancer Institute).']
with gr.Blocks(theme="JohnSmith9982/small_and_pretty@=1.0.0") as demo:
    gr.Markdown("# **Add factors to consider in your GeoARK query**")
    gr.Markdown("Enter your GeoARK query and possible factors to consider will be generated in ~7 minutes.\nThen, check the factors you'll like your search to consider when looking for geo-hotspots.")
    user_input = gr.Textbox(label="Enter your query")
    submit_query_btn = gr.Button("Generate factors")
    selected_factors = gr.CheckboxGroup([], label="Potentially relevant factors", info="May take ~7 minutes.")
    submit_query_btn.click(fn=generate_factors, inputs=user_input, outputs=selected_factors)

    submit_factors_btn = gr.Button("Submit")
    output = gr.Textbox(label="Factors you'll like to consider saved to 'considered_factors.txt'.", interactive=False)
    submit_factors_btn.click(fn=save_selected_factors, inputs=selected_factors, outputs=output, api_name="save_selected_factors")

if __name__ == "__main__":
    demo.launch(debug=True) # Turn off in production

